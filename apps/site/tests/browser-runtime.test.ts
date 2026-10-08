import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

void test('the browser command loads installed shared Access helpers before collecting real tests', () => {
  const environment = { ...process.env };
  delete environment.NODE_OPTIONS;
  const result = spawnSync(
    'pnpm',
    ['run', 'test:e2e', 'tests/e2e/a11y-pseudo-locale.spec.ts', '--project=a11y', '--list'],
    {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: environment,
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Total: 6 tests in 1 file/);
  assert.doesNotMatch(result.stdout + result.stderr, /Stripping types|No tests found/);
});
