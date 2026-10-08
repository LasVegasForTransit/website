import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import config from '../playwright.config';

const read = (path: string): { extends: string | string[] } =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as {
    extends: string | string[];
  };

void test('website config extends the shared Astro and script type policies', () => {
  assert.ok(
    read('../tsconfig.json').extends.includes('@lasvegasfortransit/typescript-config/astro.json'),
  );
  assert.equal(
    read('../scripts/tsconfig.json').extends,
    '@lasvegasfortransit/typescript-config/base.json',
  );
});

void test('shared browser defaults retain product screenshot and credential boundaries', () => {
  assert.equal(config.use?.trace, 'off');
  assert.equal(config.expect?.toHaveScreenshot?.maxDiffPixelRatio, 0.01);
  assert.equal(config.snapshotPathTemplate, 'tests/snapshots/{platform}/{projectName}/{arg}{ext}');
  assert.equal(config.testIgnore, '**/support/**');
  assert.deepEqual(
    config.projects?.map((project) => project.name),
    [
      'ui-contracts',
      'mobile-portrait',
      'mobile-landscape',
      'tablet-portrait',
      'tablet-landscape',
      'desktop',
      'desktop-xl',
      'a11y',
      'perf-memory',
    ],
  );
});
