import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

interface Requirement {
  name: string;
  use?: string;
  targets?: string[];
  listOnly?: boolean;
}

function manifest(): { secrets: Requirement[]; forbidden: Requirement[] } {
  const file = new URL('../platform.json', import.meta.url);
  assert.ok(existsSync(file), 'shared production setup requires apps/site/platform.json');
  return JSON.parse(readFileSync(file, 'utf8')) as {
    secrets: Requirement[];
    forbidden: Requirement[];
  };
}

void test('production readiness includes every credential the deployed Worker binds', () => {
  const config = readFileSync(
    new URL('../../deploy/cloudflare.config.ts', import.meta.url),
    'utf8',
  );
  const bound = [...config.matchAll(/(LVBT_[A-Z_]+): bindings\.secret\(\)/g)].map(
    (match) => match[1],
  );
  assert.ok(bound.length > 0, 'the canonical config must declare runtime credentials');
  const requirements = manifest().secrets;
  for (const name of bound) {
    const requirement = requirements.find((entry) => entry.name === name);
    assert.equal(requirement?.use, 'live', `${name} must gate production readiness`);
    assert.deepEqual(requirement.targets, ['worker'], `${name} must stay on the production Worker`);
    const forbidden = manifest().forbidden.find((entry) => entry.name === name);
    assert.deepEqual(
      forbidden?.targets,
      ['github:worker-preview', 'github:worker-candidate'],
      `${name} must never be copied into release environments`,
    );
  }
});

void test('future volunteer account credentials remain listed without setup actions', () => {
  const requirements = manifest().secrets;
  for (const name of ['LVBT_GOOGLE_SERVICE_ACCOUNT_KEY', 'LVBT_GOOGLE_ADMIN_SUBJECT']) {
    const requirement = requirements.find((entry) => entry.name === name);
    assert.equal(requirement?.use, 'future');
    assert.equal(requirement.listOnly, true, `${name} has no consumer and must never be prompted`);
  }
});

void test('production forbids local sign-in code logging', () => {
  assert.ok(manifest().forbidden.some((entry) => entry.name === 'LVBT_DEV_LOG_CODES'));
});
