import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runPromote, runWorkerRelease } from '@lasvegasfortransit/web-platform/release';
import { releaseConfiguration } from '../scripts/deploy/release-config';
import { packageRelease } from '../scripts/deploy/release-artifact';

void test('queue-only newsletter rollout cannot request production promotion', async () => {
  await assert.rejects(runPromote(releaseConfiguration, ['--help']), /preview-only/i);
});

void test('queue-only newsletter rollout blocks production upload and activation but preserves preview verification', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lvbt-newsletter-release-gate-'));
  try {
    const source = path.join(root, 'source'),
      directory = path.join(root, 'release');
    await mkdir(path.join(source, 'dist'), { recursive: true });
    await mkdir(path.join(source, '.wrangler/worker'), { recursive: true });
    await writeFile(path.join(source, 'dist/index.html'), '<p>Synthetic release</p>');
    await writeFile(path.join(source, '.wrangler/worker/index.js'), 'export default {}');
    await writeFile(path.join(source, 'wrangler.jsonc'), '{"name":"lvbt-website"}');
    await packageRelease(source, directory, { commit: 'a'.repeat(40), releaseId: '12345' });
    for (const command of ['upload', 'activate'])
      await assert.rejects(
        runWorkerRelease(releaseConfiguration, [
          command,
          '--directory',
          directory,
          '--target',
          'production',
        ]),
        /preview-only/i,
      );
    await assert.rejects(
      runWorkerRelease(releaseConfiguration, [
        'upload',
        '--directory',
        directory,
        '--target',
        'preview',
      ]),
      /attestation/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
