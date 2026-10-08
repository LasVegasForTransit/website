import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

void test('the real Worker type check remains deterministic after local dotenv bootstrap', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'website-worker-types-'));
  const cli = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
  const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { scripts: { 'worker:types': string } };
  const environment: NodeJS.ProcessEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
  if (
    packageJson.scripts['worker:types'].startsWith('CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false ')
  )
    environment.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';
  const run = (...args: string[]) =>
    execFileSync(process.execPath, [cli, 'types', 'env.d.ts', '--include-runtime=false', ...args], {
      cwd: temporary,
      env: environment,
      stdio: 'pipe',
    });
  try {
    writeFileSync(path.join(temporary, 'index.js'), 'export default {};\n');
    writeFileSync(
      path.join(temporary, 'wrangler.jsonc'),
      JSON.stringify({ name: 'types-fixture', main: 'index.js', compatibility_date: '2026-10-07' }),
    );
    run();
    const original = readFileSync(path.join(temporary, 'env.d.ts'), 'utf8');
    writeFileSync(path.join(temporary, '.env.local'), 'OPTIONAL_LOCAL_INTEGRATION=fixture-only\n');
    run('--check');
    assert.equal(readFileSync(path.join(temporary, 'env.d.ts'), 'utf8'), original);
    assert.doesNotMatch(original, /OPTIONAL_LOCAL_INTEGRATION/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
