import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { unzipSync } from 'fflate';
import { object } from './preflight-api';
import { validateIdentity, verifyStaffRelease } from './release-artifact';
import { digest } from './release-files';

const execute = promisify(execFile);
const MAX_ARCHIVE = 64 * 1024 * 1024;
const MAX_CONTENT = 128 * 1024 * 1024;
export interface ReleaseProvider {
  run(repository: string, runId: string): Promise<unknown>;
  artifacts(repository: string, runId: string): Promise<unknown[]>;
  download(repository: string, artifactId: string): Promise<Uint8Array>;
}
async function github(path: string, binary = false) {
  try {
    const result = await execute('gh', ['api', path], {
      encoding: 'buffer',
      maxBuffer: MAX_ARCHIVE,
      timeout: 120_000,
    });
    return binary
      ? result.stdout
      : (JSON.parse(new TextDecoder().decode(result.stdout)) as unknown);
  } catch {
    throw new Error('GitHub release metadata or archive could not be retrieved.');
  }
}
const provider: ReleaseProvider = {
  run: (repository, runId) => github(`repos/${repository}/actions/runs/${runId}`),
  async artifacts(repository, runId) {
    const entries: unknown[] = [];
    for (let page = 1; page <= 100; page++) {
      const response = object(
        await github(
          `repos/${repository}/actions/runs/${runId}/artifacts?per_page=100&page=${page}`,
        ),
      );
      if (!Array.isArray(response.artifacts) || !Number.isSafeInteger(response.total_count))
        throw new Error('Invalid GitHub artifact inventory.');
      entries.push(...(response.artifacts as unknown[]));
      if (entries.length === response.total_count) return entries;
      if (!response.artifacts.length || entries.length > Number(response.total_count)) break;
    }
    throw new Error('Incomplete GitHub artifact inventory.');
  },
  async download(repository, artifactId) {
    return (await github(
      `repos/${repository}/actions/artifacts/${artifactId}/zip`,
      true,
    )) as Uint8Array;
  },
};

function validateRepository(run: Record<string, unknown>, repository: string) {
  const repo = object(run.repository);
  if (
    repo.full_name !== repository ||
    !Number.isSafeInteger(repo.id) ||
    Number(repo.id) < 1 ||
    object(run.head_repository).full_name !== repository ||
    object(run.head_repository).id !== repo.id
  )
    throw new Error('The selected build must belong to this repository.');
  return repo;
}
function validateRun(runValue: unknown, repository: string, runId: string) {
  const run = object(runValue);
  const identity = { commit: String(run.head_sha), releaseId: runId };
  validateIdentity(identity);
  const repo = validateRepository(run, repository);
  if (
    String(run.id) !== runId ||
    !Number.isSafeInteger(run.id) ||
    !Number.isSafeInteger(run.run_attempt) ||
    Number(run.run_attempt) < 1 ||
    run.name !== 'Build staff release' ||
    run.path !== '.github/workflows/build-staff-release.yml' ||
    !['push', 'workflow_dispatch'].includes(String(run.event)) ||
    run.head_branch !== 'main' ||
    run.status !== 'completed' ||
    run.conclusion !== 'success'
  )
    throw new Error('Select a successful main-branch staff build from this repository.');
  return { run, repo, identity };
}
function selectedRelease(
  runValue: unknown,
  artifacts: unknown[],
  repository: string,
  runId: string,
) {
  const { run, repo, identity } = validateRun(runValue, repository, runId);
  const matches = artifacts.map(object).filter((item) => item.name === `staff-release-${runId}`);
  if (matches.length !== 1) throw new Error('Select exactly one saved staff release artifact.');
  const artifact = matches[0];
  const origin = object(artifact.workflow_run);
  if (
    !Number.isSafeInteger(artifact.id) ||
    Number(artifact.id) < 1 ||
    artifact.expired !== false ||
    !/^sha256:[a-f0-9]{64}$/.test(String(artifact.digest)) ||
    !Number.isSafeInteger(artifact.size_in_bytes) ||
    Number(artifact.size_in_bytes) < 1 ||
    Number(artifact.size_in_bytes) > MAX_ARCHIVE ||
    origin.id !== run.id ||
    origin.repository_id !== repo.id ||
    origin.head_repository_id !== repo.id ||
    origin.head_branch !== 'main' ||
    origin.head_sha !== identity.commit
  )
    throw new Error('Saved artifact provenance or digest is unavailable.');
  return {
    ...identity,
    artifactId: String(artifact.id),
    archiveDigest: String(artifact.digest),
    archiveSize: Number(artifact.size_in_bytes),
  };
}

export async function prepareStaffRelease(
  options: { repository: string; runId: string; directory: string },
  client: ReleaseProvider = provider,
) {
  if (
    !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(options.repository) ||
    !/^[1-9][0-9]*$/.test(options.runId)
  )
    throw new Error('Pass a repository and numeric Actions run ID.');
  const selected = selectedRelease(
    await client.run(options.repository, options.runId),
    await client.artifacts(options.repository, options.runId),
    options.repository,
    options.runId,
  );
  const archive = await client.download(options.repository, selected.artifactId);
  if (
    archive.length !== selected.archiveSize ||
    `sha256:${digest(archive)}` !== selected.archiveDigest
  )
    throw new Error('Downloaded archive differs from the GitHub artifact digest.');
  const names = new Set<string>();
  let size = 0;
  const files = unzipSync(archive, {
    filter(file) {
      const name = file.name.endsWith('/') ? file.name.slice(0, -1) : file.name;
      if (
        !/^[\x21-\x7e]+$/.test(name) ||
        /[\\:]/.test(name) ||
        name.split('/').some((part) => !part || part === '.' || part === '..') ||
        names.has(name)
      )
        throw new Error('Archive contains an unsafe or duplicate path.');
      names.add(name);
      size += file.originalSize;
      if (names.size > 10_000 || size > MAX_CONTENT)
        throw new Error('Archive exceeds release limits.');
      return !file.name.endsWith('/');
    },
  });
  // Never reuse or remove a destination owned by an earlier preparation.
  await mkdir(options.directory, { recursive: false });
  try {
    for (const [name, content] of Object.entries(files)) {
      await mkdir(dirname(join(options.directory, name)), { recursive: true });
      await writeFile(join(options.directory, name), content, { flag: 'wx' });
    }
    const release = await verifyStaffRelease(options.directory, selected);
    return { ...selected, artifactHash: release.artifactHash };
  } catch {
    await rm(options.directory, { recursive: true, force: true });
    throw new Error('Downloaded staff release failed content verification.');
  }
}
