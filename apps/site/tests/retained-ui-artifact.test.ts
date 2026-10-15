import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { validateRetainedUiArtifact } from '../scripts/audit/local-ui-contracts';
import { packageRelease, verifyRelease } from '../scripts/deploy/release-artifact';
import { builtHtmlPagePaths, builtSitemapPaths } from './support/sitemap-paths';

const identity = { commit: 'a'.repeat(40), releaseId: '12345' };

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lvbt-retained-ui-test-'));
  const source = path.join(root, 'source');
  const release = path.join(root, 'release');
  await mkdir(path.join(source, 'dist/retained-page'), { recursive: true });
  await mkdir(path.join(source, '.wrangler/worker'), { recursive: true });
  await writeFile(path.join(source, 'dist/index.html'), '<html><h1>Retained home</h1></html>');
  await writeFile(path.join(source, 'dist/retained-page/index.html'), '<html>Retained</html>');
  await writeFile(
    path.join(source, 'dist/sitemap-0.xml'),
    '<urlset><url><loc>https://lasvegasfortransit.org/retained-page/</loc></url></urlset>',
  );
  await writeFile(path.join(source, '.wrangler/worker/index.js'), 'export default {}');
  await writeFile(path.join(source, 'wrangler.jsonc'), '{"name":"lvbt-website"}');
  const manifest = await packageRelease(source, release, identity);
  return { root, source, release, manifest };
}

void test('retained validation uses the selected immutable files and leaves its input untouched', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.source, 'dist/index.html'), '<html>New source build</html>');
    let runtimeDirectory = '';
    await validateRetainedUiArtifact(f.release, identity, async (directory) => {
      runtimeDirectory = directory;
      assert.notEqual(directory, f.release);
      assert.deepEqual(await verifyRelease(directory), f.manifest);
      assert.equal(
        await readFile(path.join(directory, 'dist/index.html'), 'utf8'),
        '<html><h1>Retained home</h1></html>',
      );
      assert.deepEqual(builtSitemapPaths(import.meta.url, path.join(directory, 'dist')), [
        '/retained-page/',
      ]);
      assert.deepEqual(builtHtmlPagePaths(import.meta.url, path.join(directory, 'dist')), [
        '/',
        '/retained-page/',
      ]);
    });
    await assert.rejects(readFile(path.join(runtimeDirectory, 'release.json')), { code: 'ENOENT' });
    assert.deepEqual(await verifyRelease(f.release), f.manifest);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('a different source commit or release run cannot be validated', async () => {
  const f = await fixture();
  try {
    for (const expected of [
      { ...identity, commit: 'b'.repeat(40) },
      { ...identity, releaseId: '67890' },
    ]) {
      await assert.rejects(
        validateRetainedUiArtifact(f.release, expected, () =>
          Promise.reject(new Error('Must reject before running a browser.')),
        ),
        /selected build/,
      );
    }
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

for (const target of ['runtime copy', 'retained input']) {
  void test(`validation rejects a changed ${target}`, async () => {
    const f = await fixture();
    try {
      await assert.rejects(
        validateRetainedUiArtifact(f.release, identity, async (directory) => {
          await writeFile(
            path.join(target === 'runtime copy' ? directory : f.release, 'dist/index.html'),
            '<html>Changed during validation</html>',
          );
        }),
        /reviewed artifact/,
      );
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
}

void test('validation rejects changes to the retained manifest itself', async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      validateRetainedUiArtifact(f.release, identity, async (directory) => {
        await writeFile(path.join(directory, 'release.json'), JSON.stringify(f.manifest));
      }),
      /reviewed artifact manifest/,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('main signs only after exact retained artifact validation succeeds', async () => {
  const workflow = await readFile(
    new URL('../../../.github/workflows/deploy-production.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /artifact-validation:\s+name: Validate retained release\s+needs: build/);
  assert.match(workflow, /artifact-name: website-release-\$\{\{ github.run_id \}\}/);
  assert.match(workflow, /commit: \$\{\{ github.sha \}\}/);
  assert.match(
    workflow,
    /attest:\s+name: Sign retained release\s+needs: \[build, artifact-validation\]/,
  );
});

void test('PR workflow validates the head commit artifact with read-only permissions', async () => {
  const workflow = await readFile(
    new URL('../../../.github/workflows/deploy-worker-preview.yml', import.meta.url),
    'utf8',
  );
  assert.match(
    workflow,
    /artifact-validation:\s+name: Validate retained PR preview\s+needs: preview/,
  );
  assert.match(workflow, /ref: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.match(workflow, /artifact-name: website-release-pr-\$\{\{ github.run_id \}\}/);
  assert.match(workflow, /commit: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.doesNotMatch(workflow, /secrets:|environment:|: write|wrangler/);
});

void test('artifact action downloads one exact payload and runs local contracts without rebuilding', async () => {
  const action = await readFile(
    new URL('../../../.github/actions/validate-retained-ui/action.yml', import.meta.url),
    'utf8',
  );
  assert.match(action, /actions\/download-artifact@[a-f0-9]{40}/);
  assert.match(action, /name: \$\{\{ inputs.artifact-name \}\}/);
  assert.match(
    action,
    /test:ui-contracts --artifact "\$ARTIFACT_DIRECTORY" --commit\s+"\$RELEASE_COMMIT" --release-id "\$RELEASE_ID"/,
  );
  assert.doesNotMatch(
    action,
    /pnpm build|pnpm check|merge-multiple:|pattern:|CLOUDFLARE_API_TOKEN|secrets\./,
  );
});
