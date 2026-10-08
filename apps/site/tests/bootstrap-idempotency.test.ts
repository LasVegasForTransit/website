import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

interface Finding {
  ok: boolean;
  warning?: boolean;
  detail: string;
}

async function withCheckout(
  run: (directory: string, check: (apply: boolean) => Finding[]) => void,
) {
  const modulePath = '@lasvegasfortransit/cli/local';
  const { localEnvironment } = (await import(modulePath)) as {
    localEnvironment: (directory: string, options: { apply: boolean }) => Finding[];
  };
  const directory = mkdtempSync(path.join(os.tmpdir(), 'lvbt-website-setup-'));
  try {
    mkdirSync(path.join(directory, '.lvbt'));
    mkdirSync(path.join(directory, 'apps/site'), { recursive: true });
    copyFileSync(
      new URL('../../../.lvbt/tooling.json', import.meta.url),
      path.join(directory, '.lvbt/tooling.json'),
    );
    copyFileSync(
      new URL('../.env.example', import.meta.url),
      path.join(directory, 'apps/site/.env.example'),
    );
    run(directory, (apply) => localEnvironment(directory, { apply }));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

void test('website preflight reports a fresh clone without writing private local settings', async () => {
  await withCheckout((directory, check) => {
    const findings = check(false);
    assert.ok(
      findings.some((finding) => !finding.ok && finding.detail.includes('apps/site/.env.local')),
    );
    assert.throws(() => readFileSync(path.join(directory, 'apps/site/.env.local')), {
      code: 'ENOENT',
    });
  });
});

void test('website bootstrap seeds the real example and preserves a contributors existing settings', async () => {
  await withCheckout((directory, check) => {
    assert.ok(check(true).every((finding) => finding.ok));
    const file = path.join(directory, 'apps/site/.env.local');
    assert.equal(
      readFileSync(file, 'utf8'),
      readFileSync(path.join(directory, 'apps/site/.env.example'), 'utf8'),
    );
    const original = '# local settings\nLVBT_NOTION_API_KEY=private-local-test-value\n';
    writeFileSync(file, original);
    const findings = check(true);
    assert.equal(readFileSync(file, 'utf8'), original);
    assert.ok(findings.every((finding) => finding.ok));
    assert.ok(findings.some((finding) => finding.warning));
    assert.ok(!JSON.stringify(findings).includes('private-local-test-value'));
  });
});
