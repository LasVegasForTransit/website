import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
void test('the Docker context defaults to exclusion and the runtime image copies only the dependency/source closure', async () => {
  const policy = await readFile(new URL('../Dockerfile.dockerignore', import.meta.url), 'utf8');
  const lines = policy.split('\n').filter((line) => line && !line.startsWith('#'));
  assert.equal(lines[0], '**');
  for (const pattern of [
    '**/node_modules',
    '**/.superpowers',
    '**/.git',
    '**/.env*',
    '**/.dev.vars*',
    '**/*.pem',
    '**/*.key',
  ])
    assert.ok(lines.includes(pattern), pattern);
  assert.deepEqual(
    lines.filter((line) => line.startsWith('!')),
    [
      '!package.json',
      '!pnpm-lock.yaml',
      '!pnpm-workspace.yaml',
      '!.lvbt/web-platform/packages/**',
      '!apps/*/package.json',
      '!apps/workspace-connector/src/**',
      '!packages/*/package.json',
      '!packages/platform-core/src/**',
      '!packages/platform-integrations/src/**',
      '!packages/platform-storage/src/**',
    ],
  );
  assert.ok(lines.includes('!apps/workspace-connector/src/**'));
  assert.ok(lines.includes('!.lvbt/web-platform/packages/**'));
  const docker = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  const final = docker.split(' AS runtime\n')[1];
  assert.ok(final, 'a separate runtime stage is required');
  assert.ok(
    !/^COPY (?!.*--from=)/m.test(final),
    'runtime copies must come only from the clean dependency stage',
  );
  assert.ok(!final.includes('COPY . .'));
  assert.ok(!final.includes('/build/.lvbt'));
});
