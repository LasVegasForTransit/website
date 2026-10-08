import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import cloudflare from '../cloudflare.config.ts';
import wranglerBuild from '../wrangler.config.ts';

const deployDir = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const siteDir = path.resolve(deployDir, '../site');
const platform = JSON.parse(await readFile(path.join(siteDir, 'platform.json'), 'utf8')) as {
  secrets: Array<{ name: string; use?: string; targets?: string[] }>;
};
const tooling = JSON.parse(
  await readFile(path.resolve(deployDir, '../../.lvbt/tooling.json'), 'utf8'),
) as {
  release: {
    appDirectory: string;
    artifactSource: string;
    typedConfig: string;
    assetsDirectory: string;
    workersDevSubdomain: string;
    previewBindings: Record<string, unknown>;
    migrations: Array<{ binding: string; directory: string }>;
  };
};
const production = cloudflare({ mode: 'production', isPreview: false });
const preview = cloudflare({ mode: 'preview', isPreview: false });

void test('canonical config identifies both public domains and the protected preview domain', () => {
  assert.deepEqual(production.worker.domains, [
    'lasvegasfortransit.org',
    'www.lasvegasfortransit.org',
  ]);
  assert.deepEqual(preview.worker.domains, ['preview.lasvegasfortransit.org']);
  assert.equal(production.worker.name, 'lvbt-website');
  assert.equal(preview.worker.name, 'lvbt-website-preview');
  assert.equal('accountId' in production, false);
});
void test('production and preview retain existing secret types and declared integration names without values', () => {
  const names = platform.secrets
    .filter((secret) => secret.use === 'live' && secret.targets?.includes('worker'))
    .map((secret) => secret.name)
    .sort();
  for (const built of [production, preview]) {
    assert.deepEqual(built.worker.unsafe, {
      metadata: { keep_bindings: ['secret_text', 'secret_key'] },
    });
    const bindings: Record<string, { type: string }> = built.worker.env;
    assert.deepEqual(
      Object.entries(bindings)
        .filter(([, binding]) => binding.type === 'secret')
        .map(([name]) => name)
        .sort(),
      names,
    );
    for (const name of names) assert.deepEqual(bindings[name], { type: 'secret' });
  }
});
void test('new release artifacts use typed configuration, frozen SQL and explicit isolated preview declarations', () => {
  assert.equal(tooling.release.appDirectory, 'apps/deploy');
  assert.equal(tooling.release.artifactSource, 'typed-worker');
  assert.equal(tooling.release.typedConfig, 'cloudflare.config.ts');
  assert.equal(tooling.release.assetsDirectory, '../site/dist');
  assert.equal(tooling.release.workersDevSubdomain, 'las-vegas-for-better-transit');
  assert.deepEqual(tooling.release.previewBindings, preview.worker.env);
  assert.deepEqual(tooling.release.migrations, [
    { binding: 'PLATFORM_DB', directory: '../site/platform/storage/migrations' },
  ]);
  assert.deepEqual(preview.worker.env.PLATFORM_DB, {
    type: 'd1',
    name: 'lvbt-platform-preview',
    id: '8bb072e7-9865-487a-8867-d97fdb2ea00b',
  });
  assert.notEqual(production.worker.env.PLATFORM_DB.id, preview.worker.env.PLATFORM_DB.id);
  assert.deepEqual(preview.worker.assets, { ...production.worker.assets, runWorkerFirst: true });
  assert.equal(
    path.resolve(deployDir, (wranglerBuild as { assetsDirectory: string }).assetsDirectory),
    path.join(siteDir, 'dist'),
  );
});

void test('generated compatibility mirror preserves actual routes, database identities, asset routing and secret retention in both modes', async () => {
  interface Mode {
    name: string;
    unsafe: unknown;
    routes: Array<{ pattern: string; custom_domain: boolean }>;
    d1_databases: Array<{
      binding: string;
      database_name: string;
      database_id: string;
      migrations_dir: string;
    }>;
    assets: { directory: string; run_worker_first: string[] | boolean; not_found_handling: string };
  }
  const parsed = ts.parseConfigFileTextToJson(
    'wrangler.jsonc',
    await readFile(path.join(siteDir, 'wrangler.jsonc'), 'utf8'),
  );
  assert.equal(parsed.error, undefined);
  const mirror = parsed.config as Mode & {
    main: string;
    compatibility_date: string;
    compatibility_flags: string[];
    env: { preview: Mode };
  };
  assert.equal(
    path.resolve(siteDir, mirror.main),
    path.resolve(deployDir, production.worker.entrypoint),
  );
  assert.equal(mirror.compatibility_date, production.worker.compatibilityDate);
  assert.deepEqual(mirror.compatibility_flags, production.worker.compatibilityFlags);
  for (const [built, mode] of [
    [production, mirror],
    [preview, mirror.env.preview],
  ] as const) {
    assert.equal(mode.name, built.worker.name);
    assert.deepEqual(
      mode.routes,
      built.worker.domains.map((pattern) => ({ pattern, custom_domain: true })),
    );
    assert.deepEqual(mode.unsafe, built.worker.unsafe);
    assert.equal(path.resolve(siteDir, mode.assets.directory), path.join(siteDir, 'dist'));
    const expectedRouting = built.worker.assets.runWorkerFirst;
    assert.deepEqual(
      mode.assets.run_worker_first,
      Array.isArray(expectedRouting) ? [...expectedRouting, '/lvbt-release.json'] : expectedRouting,
    );
    assert.equal(mode.assets.not_found_handling, built.worker.assets.notFoundHandling);
    assert.deepEqual(mode.d1_databases, [
      {
        binding: 'PLATFORM_DB',
        database_name: built.worker.env.PLATFORM_DB.name,
        database_id: built.worker.env.PLATFORM_DB.id,
        migrations_dir: 'platform/storage/migrations',
      },
    ]);
  }
});
