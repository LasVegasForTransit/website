import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

void test('baseline cache seeding accepts only the exact current pointer content', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'lvbt-baseline-seed-'));
  try {
    const pointers = path.join(temporary, 'pointers');
    const seed = path.join(temporary, 'seed');
    const objects = path.join(temporary, 'objects');
    await mkdir(pointers);
    await mkdir(seed);
    const accepted = 'accepted image';
    const oid = createHash('sha256').update(accepted).digest('hex');
    const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${accepted.length}\n`;
    for (const name of ['accepted', 'changed', 'missing']) {
      await writeFile(path.join(pointers, `${name}.png`), pointer);
    }
    await writeFile(path.join(seed, 'accepted.png'), accepted);
    await writeFile(path.join(seed, 'changed.png'), 'modified image');
    await writeFile(path.join(seed, 'unrequested.png'), accepted);
    const script = fileURLToPath(
      new URL('../../../.github/actions/linux-baselines/seed-cache.mjs', import.meta.url),
    );
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [script, '--pointers', pointers, '--seed', seed, '--objects', objects],
        { encoding: 'utf8' },
      ),
    ) as { seeded: number; missing: number; unmatched: number; bytes: number };
    assert.deepEqual(result, { seeded: 1, missing: 1, unmatched: 1, bytes: accepted.length });
    assert.deepEqual(
      await readFile(path.join(objects, oid.slice(0, 2), oid.slice(2, 4), oid), 'utf8'),
      accepted,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
