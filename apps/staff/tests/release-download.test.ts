import assert from 'node:assert/strict';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { zipSync } from 'fflate';
import { packageStaffRelease, verifyStaffRelease } from '../scripts/release-artifact';
import { digest } from '../scripts/release-files';
import { prepareStaffRelease } from '../scripts/release-download';
import { releaseFixture, releaseIdentity } from './support/release';

async function fixture() {
  const f = await releaseFixture();
  const release = await packageStaffRelease(f.source, f.destination, releaseIdentity);
  const entries: Record<string, Uint8Array> = {};
  for (const [name] of [...release.files, ['release.json', '']])
    entries[name] = await readFile(join(f.destination, name));
  const archive = zipSync(entries);
  const repository = 'LasVegasForTransit/website';
  const run = {
    id: 12345,
    run_attempt: 1,
    name: 'Build staff release',
    path: '.github/workflows/build-staff-release.yml',
    event: 'push',
    head_branch: 'main',
    head_sha: releaseIdentity.commit,
    status: 'completed',
    conclusion: 'success',
    repository: { id: 77, full_name: repository },
    head_repository: { id: 77, full_name: repository },
  };
  const artifact = {
    id: 99,
    name: 'staff-release-12345',
    expired: false,
    digest: `sha256:${digest(archive)}`,
    size_in_bytes: archive.length,
    workflow_run: {
      id: 12345,
      repository_id: 77,
      head_repository_id: 77,
      head_branch: 'main',
      head_sha: releaseIdentity.commit,
    },
  };
  const destination = join(f.root, 'downloaded');
  const provider = {
    run() {
      return Promise.resolve(run);
    },
    artifacts() {
      return Promise.resolve([artifact]);
    },
    download() {
      return Promise.resolve(archive);
    },
  };
  return { ...f, destination, repository, run, artifact, archive, entries, provider };
}

void test('preparation retrieves and verifies the exact successful main build without rebuilding', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.source, 'apps/jobs/dist/index.js'), 'unrelated later source');
    const result = await prepareStaffRelease(
      { directory: f.destination, repository: f.repository, runId: '12345' },
      f.provider,
    );
    assert.equal(result.commit, 'a'.repeat(40));
    assert.equal(result.artifactId, '99');
    assert.equal(result.releaseId, '12345');
    assert.equal(
      await readFile(join(f.destination, 'jobs/worker/index.js'), 'utf8'),
      'export default { scheduled() {} };',
    );
    await verifyStaffRelease(f.destination, releaseIdentity);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('untrusted, unfinished, wrong-run or ambiguous artifacts cannot create a release', async () => {
  const f = await fixture();
  try {
    const original = structuredClone(f.run);
    const changes = [
      { conclusion: 'failure' },
      { status: 'in_progress' },
      { head_branch: 'other' },
      { event: 'pull_request' },
      { path: '.github/workflows/other.yml' },
      { id: 999 },
      { run_attempt: 0 },
      { head_sha: 'not-a-sha' },
      { repository: { id: 77, full_name: 'other/repo' } },
      { head_repository: { id: 78, full_name: f.repository } },
    ];
    for (const change of changes) {
      Object.assign(f.run, original, change);
      await assert.rejects(
        prepareStaffRelease(
          { directory: f.destination, repository: f.repository, runId: '12345' },
          f.provider,
        ),
      );
      assert.equal((await readdir(f.root)).includes('downloaded'), false);
    }
    Object.assign(f.run, original);
    const artifactOriginal = structuredClone(f.artifact);
    for (const change of [
      { expired: true },
      { digest: null },
      { name: 'staff-release-999' },
      { workflow_run: { ...f.artifact.workflow_run, head_sha: 'b'.repeat(40) } },
      { workflow_run: { ...f.artifact.workflow_run, head_repository_id: 78 } },
      { size_in_bytes: -1 },
    ]) {
      Object.assign(f.artifact, artifactOriginal, change);
      await assert.rejects(
        prepareStaffRelease(
          { directory: f.destination, repository: f.repository, runId: '12345' },
          f.provider,
        ),
      );
    }
    Object.assign(f.artifact, artifactOriginal);
    await assert.rejects(
      prepareStaffRelease(
        { directory: f.destination, repository: f.repository, runId: '12345' },
        {
          ...f.provider,
          artifacts() {
            return Promise.resolve([f.artifact, f.artifact]);
          },
        },
      ),
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('archive corruption, path traversal and wrong internal identity leave no prepared release', async () => {
  const f = await fixture();
  try {
    for (const archive of [
      new Uint8Array([1, 2, 3]),
      zipSync({ ...f.entries, '../escaped': new Uint8Array([1]) }),
      zipSync({ ...f.entries, 'release.json': new TextEncoder().encode('{}') }),
    ]) {
      if (archive.length > 3) {
        f.artifact.digest = `sha256:${digest(archive)}`;
        f.artifact.size_in_bytes = archive.length;
      }
      await assert.rejects(
        prepareStaffRelease(
          { directory: f.destination, repository: f.repository, runId: '12345' },
          {
            ...f.provider,
            download() {
              return Promise.resolve(archive);
            },
          },
        ),
      );
      assert.equal((await readdir(f.root)).includes('downloaded'), false);
      assert.equal((await readdir(f.root)).includes('escaped'), false);
    }
    await prepareStaffRelease(
      { directory: f.destination, repository: f.repository, runId: '12345' },
      {
        ...f.provider,
        artifacts() {
          return Promise.resolve([
            {
              ...f.artifact,
              digest: `sha256:${digest(f.archive)}`,
              size_in_bytes: f.archive.length,
            },
          ]);
        },
      },
    );
    await assert.rejects(
      prepareStaffRelease(
        { directory: f.destination, repository: f.repository, runId: '12345' },
        f.provider,
      ),
    );
    await verifyStaffRelease(f.destination, releaseIdentity);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('malformed manifests cannot disclose their contents in release errors', async () => {
  const f = await fixture();
  try {
    const archive = zipSync({
      ...f.entries,
      'release.json': new TextEncoder().encode('DO-NOT-DISCLOSE-PRIVATE-CONTENT'),
    });
    f.artifact.digest = `sha256:${digest(archive)}`;
    f.artifact.size_in_bytes = archive.length;
    await assert.rejects(
      prepareStaffRelease(
        { directory: f.destination, repository: f.repository, runId: '12345' },
        {
          ...f.provider,
          download() {
            return Promise.resolve(archive);
          },
        },
      ),
      (error: unknown) => {
        assert.equal(String(error).includes('DO-NOT'), false);
        return true;
      },
    );
    assert.equal((await readdir(f.root)).includes('downloaded'), false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
