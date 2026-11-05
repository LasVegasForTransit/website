import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { applyMigrations } from '@lasvegasfortransit/platform-storage/test-db';

/** Apply schema on disk, but execute the application against real workerd D1 limits. */
export async function d1Fixture() {
  const data = await mkdtemp(join(tmpdir(), 'workspace-transfer-'));
  const simulator = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("fixture")}}',
      compatibilityDate: '2026-09-04',
      resourcePersistencePath: data,
      d1Databases: { PLATFORM_DB: 'workspace-transfer' },
      telemetry: { enabled: false },
      cf: false,
    }),
  );
  async function close() {
    await simulator.dispose();
    await rm(data, { recursive: true, force: true });
  }
  try {
    const db = await simulator.getD1Database('PLATFORM_DB');
    await db.prepare('SELECT 1').all();
    const files = await readdir(data, { recursive: true });
    const file = files.find(
      (f) =>
        f.includes('d1') &&
        f.endsWith('.sqlite') &&
        !basename(f).startsWith('._') &&
        basename(f) !== 'metadata.sqlite',
    );
    assert.ok(file);
    const raw = new DatabaseSync(join(data, file));
    try {
      applyMigrations(raw);
    } finally {
      raw.close();
    }
    return { db, close };
  } catch (error) {
    await close();
    throw error;
  }
}
