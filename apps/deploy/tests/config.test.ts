import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

import { PLATFORM_SECRETS } from '../../site/scripts/bootstrap/config/platform-secrets.ts';
import cloudflare from '../cloudflare.config.ts';
import wranglerBuild from '../wrangler.config.ts';

interface WranglerMirror {
  name: string;
  vars: Record<string, string>;
  compatibility_date: string;
  compatibility_flags: string[];
  main: string;
  workers_dev: boolean;
  preview_urls: boolean;
  observability: { enabled: boolean };
  assets: {
    directory: string;
    binding: string;
    not_found_handling: string;
    run_worker_first: string[] | boolean;
  };
  d1_databases: { binding: string; database_name: string; database_id: string }[];
  env: {
    preview: {
      d1_databases: WranglerMirror['d1_databases'];
      assets: WranglerMirror['assets'];
      vars: WranglerMirror['vars'];
    };
  };
}

const deployDir = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const siteDir = path.resolve(deployDir, '../site');
const source = await readFile(path.join(siteDir, 'wrangler.jsonc'), 'utf8');
const parsed = ts.parseConfigFileTextToJson('wrangler.jsonc', source);
assert.equal(parsed.error, undefined, 'Wrangler fallback must remain valid JSONC');
const wrangler = parsed.config as WranglerMirror;

for (const mode of [undefined, 'preview']) {
  void test(`${mode ?? 'production'} cf config matches the Wrangler fallback`, () => {
    const cf = cloudflare({ mode, isPreview: false });
    const build = wranglerBuild as { assetsDirectory: string };
    const expectedAssets = mode === 'preview' ? wrangler.env.preview.assets : wrangler.assets;
    const expectedVars = mode === 'preview' ? wrangler.env.preview.vars : wrangler.vars;
    const expectedDb =
      mode === 'preview' ? wrangler.env.preview.d1_databases[0] : wrangler.d1_databases[0];
    assert.ok(expectedDb);
    assert.equal('accountId' in cf, false);
    assert.ok('unsafe' in cf.worker);
    assert.deepEqual(cf.worker.unsafe, {
      metadata: { keep_bindings: ['secret_text', 'secret_key'] },
    });
    assert.equal(cf.worker.name, mode === 'preview' ? `${wrangler.name}-preview` : wrangler.name);
    assert.equal(cf.worker.compatibilityDate, wrangler.compatibility_date);
    assert.deepEqual(cf.worker.compatibilityFlags, wrangler.compatibility_flags);
    assert.equal(
      path.resolve(deployDir, cf.worker.entrypoint),
      path.resolve(siteDir, wrangler.main),
    );
    assert.equal(
      path.resolve(deployDir, build.assetsDirectory),
      path.resolve(siteDir, wrangler.assets.directory),
    );
    assert.equal(cf.worker.workersDev, wrangler.workers_dev);
    assert.equal(cf.worker.previewUrls, wrangler.preview_urls);
    assert.deepEqual(cf.worker.observability, wrangler.observability);
    assert.deepEqual(cf.worker.assets, {
      notFoundHandling: expectedAssets.not_found_handling,
      runWorkerFirst: expectedAssets.run_worker_first,
    });
    assert.deepEqual(cf.worker.env.PLATFORM_DB, {
      type: 'd1',
      name: expectedDb.database_name,
      id: expectedDb.database_id,
    });
    assert.equal(expectedDb.binding, 'PLATFORM_DB');
    for (const [name, value] of Object.entries(expectedVars)) {
      assert.deepEqual(cf.worker.env[name as keyof typeof cf.worker.env], { type: 'text', value });
    }
    assert.deepEqual(cf.worker.env.ASSETS, { type: 'assets' });
    assert.equal(wrangler.assets.binding, 'ASSETS');

    const environment: Record<string, { type: string } | undefined> = cf.worker.env;
    const secretNames = Object.entries(environment)
      .filter(([, binding]) => binding?.type === 'secret')
      .map(([name]) => name)
      .sort();
    const expectedSecrets =
      mode === 'preview'
        ? []
        : PLATFORM_SECRETS.filter(
            (secret) => secret.use === 'live' && secret.targets.includes('worker'),
          )
            .map((secret) => secret.name)
            .sort();
    assert.deepEqual(secretNames, expectedSecrets);
  });
}
