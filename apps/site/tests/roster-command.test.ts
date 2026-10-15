import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { memoryDb, everyStoredText } from './support/platform-db';
import { executeRosterCommand } from '../scripts/platform/run-roster';
import { RosterD1 } from '../scripts/platform/roster-d1';
import { copyRosterDatabase } from '../scripts/platform/roster-sqlite';
const input = [
  {
    source: 'beehiiv',
    sourceId: 'sub_cli',
    email: 'private@example.invalid',
    newsletter: {
      state: 'active',
      affirmative: true,
      givenAt: '2026-03-01T12:00:00.000Z',
      method: 'checkbox',
    },
  },
];
void test('retry-held applies exactly the reconsideration reviewed after explicit source confirmation', async (context) => {
  const { mergeFixture } =
    await import('../../../packages/platform-storage/tests/support/merge-fixture');
  const { applyRosterImport } = await import('../platform/roster-import');
  const f = await mergeFixture(),
    dir = await mkdtemp(join(tmpdir(), 'lvbt-retry-held-'));
  context.after(async () => {
    f.db.raw.close();
    await rm(dir, { recursive: true, force: true });
  });
  const records = [{ ...input[0], email: f.survivor.email }];
  const held = await applyRosterImport(f.db, records, { runId: 'held', now: new Date() });
  assert.equal(held.counts.needsReview, 1);
  const { confirmRosterSource } =
    await import('../../../packages/platform-storage/src/roster-import-resolve');
  const receipt = f.db.raw
    .prepare("SELECT id,evidence_hash FROM roster_import_records WHERE state='held'")
    .get();
  assert.ok(receipt);
  const currentPerson = await f.people.getExactPerson(f.survivor.id);
  assert.ok(currentPerson);
  const confirmed = await confirmRosterSource(f.db, f.actor, {
    recordId: String(receipt.id),
    personId: f.survivor.id,
    evidenceHash: String(receipt.evidence_hash),
    personUpdatedAt: currentPerson.updated_at,
    operationId: 'confirm-original-source',
  });
  assert.equal(confirmed.kind, 'applied');
  const options = {
    input: join(dir, 'input.json'),
    plan: join(dir, 'plan.json'),
    account: 'a'.repeat(32),
    database: '00000000-0000-4000-8000-000000000000',
    apply: false,
    retryHeld: true,
  };
  await writeFile(options.input, JSON.stringify(records));
  assert.match(await executeRosterCommand(options, f.db), /Consent records created: 1/);
  assert.match(
    await executeRosterCommand({ ...options, apply: true }, f.db),
    /Consent records created: 1/,
  );
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM roster_import_records WHERE state='held'").get()?.n,
    0,
  );
});
void test('reviewed CLI dry run is private, predicts apply, and refuses target or input changes', async (context) => {
  const dir = await mkdtemp(join(tmpdir(), 'lvbt-import-command-')),
    db = memoryDb();
  context.after(async () => {
    db.raw.close();
    await rm(dir, { recursive: true, force: true });
  });
  const options = {
    input: join(dir, 'input.json'),
    plan: join(dir, 'plan.json'),
    account: 'a'.repeat(32),
    database: '00000000-0000-4000-8000-000000000000',
    apply: false,
  };
  await writeFile(options.input, JSON.stringify(input));
  const before = everyStoredText(db);
  const report = await executeRosterCommand(options, db);
  assert.match(report, /People created: 1/);
  assert.equal(report.includes('private@'), false);
  assert.equal(everyStoredText(db), before);
  assert.equal((await stat(options.plan)).mode & 0o777, 0o600);
  const saved = await readFile(options.plan, 'utf8');
  assert.equal(saved.includes('private@'), false);
  await assert.rejects(
    executeRosterCommand(
      { ...options, database: '11111111-1111-4111-8111-111111111111', apply: true },
      db,
    ),
    /changed/,
  );
  await writeFile(
    options.input,
    JSON.stringify([...input, { ...input[0], sourceId: 'sub_changed' }]),
  );
  await assert.rejects(executeRosterCommand({ ...options, apply: true }, db), /changed/);
  await writeFile(options.input, JSON.stringify(input));
  assert.match(await executeRosterCommand({ ...options, apply: true }, db), /People created: 1/);
  await assert.rejects(executeRosterCommand({ ...options, apply: true }, db), /changed/);
});
void test('read-only remote dry-run connection refuses writes before any API request', async () => {
  let calls = 0;
  const db = new RosterD1(
    {
      accountId: 'a'.repeat(32),
      databaseId: '00000000-0000-4000-8000-000000000000',
      token: 'fixture',
      write: false,
    },
    () => {
      calls++;
      return Promise.resolve(Response.json({}));
    },
  );
  await assert.rejects(db.prepare('DELETE FROM people').run(), /refuses database writes/);
  assert.equal(calls, 0);
});
void test('consistent snapshot copy preserves real blobs and JSON-looking text as distinct values', async () => {
  const db = memoryDb();
  db.raw.exec('CREATE TABLE fidelity (id TEXT PRIMARY KEY,bytes BLOB,text TEXT)');
  db.raw
    .prepare('INSERT INTO fidelity VALUES(?,?,?)')
    .run('fixture', new Uint8Array([0, 128, 255]), '{"$blob":"ff"}');
  const copy = await copyRosterDatabase(db);
  const row = copy.prepare('SELECT hex(bytes) AS bytes,text FROM fidelity').get();
  assert.equal(row?.bytes, '0080FF');
  assert.equal(row.text, '{"$blob":"ff"}');
  copy.close();
  db.raw.close();
});
