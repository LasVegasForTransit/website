import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { verifyRelease } from '../deploy/release-artifact';
import { withLocalWorker } from './local-worker';

export async function validateRetainedUiArtifact(
  directory: string,
  expected: { commit: string; releaseId: string },
  verify: (runtimeDirectory: string, stateDirectory: string) => Promise<void>,
): Promise<void> {
  const retained = await verifyRelease(directory);
  const manifestHash = async (candidate: string) =>
    createHash('sha256')
      .update(await readFile(path.join(candidate, 'release.json')))
      .digest('hex');
  const manifest = await manifestHash(directory);
  if (retained.commit !== expected.commit || retained.releaseId !== expected.releaseId) {
    throw new Error('Retained artifact does not match the selected build.');
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'lvbt-retained-ui-'));
  const runtimeDirectory = path.join(temporary, 'release');
  const assertUnchanged = async (candidate: string) => {
    if (
      JSON.stringify(await verifyRelease(candidate)) !== JSON.stringify(retained) ||
      (await manifestHash(candidate)) !== manifest
    ) {
      throw new Error('Local validation changed the reviewed artifact manifest.');
    }
  };
  try {
    // Wrangler writes development scratch files next to its config. Keep the downloaded
    // artifact immutable and run an identical disposable copy, without repackaging it.
    await cp(directory, runtimeDirectory, { recursive: true });
    await assertUnchanged(runtimeDirectory);
    try {
      await verify(runtimeDirectory, path.join(temporary, 'state'));
    } finally {
      await Promise.all([assertUnchanged(runtimeDirectory), assertUnchanged(directory)]);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function browserContracts(origin: string, assetsDirectory?: string): Promise<void> {
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const browser = spawn('pnpm', ['test:e2e', '--project=ui-contracts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PLAYWRIGHT_BASE_URL: origin,
        ...(assetsDirectory ? { BUILT_ASSETS_DIRECTORY: assetsDirectory } : {}),
      },
      stdio: 'inherit',
    });
    browser.once('error', reject);
    browser.once('exit', resolve);
  });
  if (exitCode !== 0) throw new Error(`Local UI contracts failed (${exitCode ?? 'signal'}).`);
}

async function run(): Promise<void> {
  const { values } = parseArgs({
    options: {
      artifact: { type: 'string' },
      commit: { type: 'string' },
      'release-id': { type: 'string' },
    },
  });
  if (!values.artifact) {
    if (values.commit || values['release-id']) throw new Error('Select an artifact directory.');
    await withLocalWorker(browserContracts);
    return;
  }
  if (!values.commit || !values['release-id']) {
    throw new Error('Artifact validation requires its expected commit and release ID.');
  }
  await validateRetainedUiArtifact(
    path.resolve(values.artifact),
    { commit: values.commit, releaseId: values['release-id'] },
    async (directory, stateDirectory) => {
      await withLocalWorker(
        async (origin) => {
          const response = await fetch(new URL('/lvbt-release.json', origin));
          const marker = (await response.json()) as { commit?: string; releaseId?: string };
          if (
            !response.ok ||
            marker.commit !== values.commit ||
            marker.releaseId !== values['release-id'] ||
            response.headers.get('cache-control') !== 'private, no-store' ||
            response.headers.get('x-robots-tag') !== 'noindex, nofollow, noarchive'
          ) {
            throw new Error('Local retained Worker identity or preview privacy does not match.');
          }
          await browserContracts(origin, path.join(directory, 'dist'));
        },
        { directory, stateDirectory },
      );
    },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
