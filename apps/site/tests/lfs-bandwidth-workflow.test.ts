import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../../../', import.meta.url);

void test('general website checkouts never download screenshot objects', async () => {
  const directory = new URL('.github/workflows/', root);
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue;
    const source = await readFile(new URL(name, directory), 'utf8');
    assert.doesNotMatch(source, /lfs:\s*true/, `${name} must leave screenshot pointers intact`);
  }
});

void test('both screenshot workflows restore the same cache before fetching Linux baselines', async () => {
  for (const name of ['audit', 'seed-baselines']) {
    const source = await readFile(new URL(`.github/workflows/${name}.yml`, root), 'utf8');
    assert.match(source, /uses: \.\/\.github\/actions\/linux-baselines/);
    assert.doesNotMatch(source, /git lfs pull/);
  }
  const action = await readFile(
    new URL('.github/actions/linux-baselines/action.yml', root),
    'utf8',
  );
  assert.ok(action.indexOf('uses: actions/cache@') < action.indexOf('run: git lfs pull'));
  assert.match(action, /path: \.git\/lfs\/objects/);
  assert.match(action, /hashFiles\('apps\/site\/tests\/snapshots\/linux\/\*\*\/\*\.png'\)/);
  assert.match(action, /restore-keys: \|\s*linux-lfs-v1-/);
  assert.match(
    action,
    /git lfs pull --include="apps\/site\/tests\/snapshots\/linux\/\*\*" --exclude=""/,
  );
  assert.doesNotMatch(action, /darwin|lfs:\s*true/);
});
