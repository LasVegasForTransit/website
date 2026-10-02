import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { packageRelease, verifyRelease } from '../scripts/deploy/release-artifact';

const identity = { commit: 'a'.repeat(40), releaseId: '12345' };

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lvbt-release-test-'));
  const source = path.join(root, 'source');
  const release = path.join(root, 'release');
  await mkdir(path.join(source, 'dist'), { recursive: true });
  await mkdir(path.join(source, '.wrangler/worker'), { recursive: true });
  await writeFile(path.join(source, 'dist/index.html'), '<h1>Arts District</h1>');
  await writeFile(path.join(source, '.wrangler/worker/index.js'), 'export default {}');
  await writeFile(path.join(source, 'wrangler.jsonc'), '{"name":"lvbt-website"}');
  return { root, source, release };
}

void test('a release retains reviewed files and identity after its source changes', async () => {
  const f = await fixture();
  try {
    const release = await packageRelease(f.source, f.release, identity);
    await writeFile(path.join(f.source, 'dist/index.html'), '<h1>Newer build</h1>');
    assert.deepEqual(await verifyRelease(f.release), release);
    assert.equal(
      await readFile(path.join(f.release, 'dist/index.html'), 'utf8'),
      '<h1>Arts District</h1>',
    );
    assert.equal(release.releaseId, '12345');
    assert.equal(
      release.files.some(([name]) => name === '.wrangler/worker/index.js'),
      true,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

for (const mutation of ['changed', 'added', 'removed', 'identity', 'symlink']) {
  void test(`verification rejects ${mutation} release content`, async () => {
    const f = await fixture();
    try {
      await packageRelease(f.source, f.release, identity);
      const index = path.join(f.release, 'dist/index.html');
      if (mutation === 'changed') await writeFile(index, 'tampered');
      if (mutation === 'added')
        await writeFile(path.join(f.release, 'dist/extra.txt'), 'unreviewed');
      if (mutation === 'removed') await rm(index);
      if (mutation === 'symlink') {
        await rm(index);
        await symlink(path.join(f.source, 'dist/index.html'), index);
      }
      if (mutation === 'identity') {
        const manifest = await verifyRelease(f.release);
        manifest.commit = 'b'.repeat(40);
        await writeFile(path.join(f.release, 'release.json'), JSON.stringify(manifest));
      }
      await assert.rejects(verifyRelease(f.release));
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
}

void test('release packaging rejects prototype routes and symlinked source assets', async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.source, 'dist/prototypes'));
    await assert.rejects(packageRelease(f.source, f.release, identity), /preview-only/i);
    await rm(path.join(f.source, 'dist/prototypes'), { recursive: true });
    await symlink(path.join(f.source, 'dist/index.html'), path.join(f.source, 'dist/linked.html'));
    await assert.rejects(packageRelease(f.source, f.release, identity), /symbolic/i);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
