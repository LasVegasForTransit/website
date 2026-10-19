import assert from 'node:assert/strict';
import test from 'node:test';
import { pendingDiscordOperations } from '../src/discord-pending';
import { completeProviderOperations } from '../src/provider-completion';
import { PersonService } from '../src/person-service';
import { memoryDb, type MemoryDb } from './support/db';

const now = new Date('2026-10-18T12:00:00.000Z');
function queuedPeople(db: MemoryDb, count: number, blocked: boolean) {
  db.raw
    .prepare(
      `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<?)
    INSERT INTO people(id,membership_status,created_at,updated_at)
    SELECT printf('p%05d',n),'member','2026-01-01','2026-01-01' FROM seq`,
    )
    .run(count);
  db.raw
    .exec(`INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at)
    SELECT id,id,'discord',id,'2026-01-01','self_linked','2026-01-01','2026-01-01' FROM people;
    INSERT INTO reconcile_generations(person_id,target_id,generation) SELECT id,'person',1 FROM people;
    INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at)
    SELECT id,'person_reconcile',id,'person',1,'{"source":"committee.assign"}','2026-01-01','2026-01-01','2026-01-01' FROM people;`);
  if (blocked) {
    db.raw
      .exec(`INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at)
      SELECT 'google-'||id,id,'google_workspace',id,'2026-01-01','self_linked','2026-01-01','2026-01-01' FROM people;`);
    for (const { id } of db.raw.prepare('SELECT id FROM integration_outbox').all())
      confirm(db, String(id));
  }
}
function confirm(db: MemoryDb, operationId: string) {
  db.raw
    .prepare(
      `INSERT INTO provider_operation_receipts(operation_id,provider,state,revision_hash,lease_token,observed_at,expires_at)
    VALUES(?,'discord','done','r','l',?,?) ON CONFLICT(operation_id,provider) DO UPDATE SET observed_at=excluded.observed_at,expires_at=excluded.expires_at`,
    )
    .run(operationId, now.toISOString(), new Date(now.getTime() + 300_000).toISOString());
}

for (const change of ['withdrawal', 'deletion']) {
  void test(`fresh ${change} bypasses a thousand blocked explicit changes`, async (t) => {
    const db = memoryDb();
    t.after(() => db.raw.close());
    queuedPeople(db, 1000, true);
    if (change === 'withdrawal')
      db.raw
        .prepare(
          "UPDATE people SET membership_status='former_member',updated_at=? WHERE id='p01000'",
        )
        .run(now.toISOString());
    else await new PersonService(db).deletePerson('p01000');
    const tick = change === 'deletion' ? new Date(Date.now() + 1000) : now;
    const selected = await pendingDiscordOperations(db, tick, 1);
    assert.equal(selected.length, 1);
    const [operationId] = selected;
    assert.ok(operationId);
    const operation = db.raw
      .prepare('SELECT person_id,payload FROM integration_outbox WHERE id=?')
      .get(operationId);
    assert.ok(operation);
    assert.equal(operation.person_id, 'p01000');
    const payload = JSON.parse(String(operation.payload)) as Record<string, unknown>;
    assert.ok(payload.removal === 1 || payload.source === 'person_deleted');
    assert.equal(await completeProviderOperations(db, { now: tick }), 0);
  });
}

void test('bounded pages visit every explicit operation and wrap without repeating fresh success', async (t) => {
  const db = memoryDb();
  t.after(() => db.raw.close());
  queuedPeople(db, 80, false);
  const seen = new Set<string>();
  for (let page = 0; page < 5; page++) {
    const selected = await pendingDiscordOperations(db, now, 100);
    assert.equal(selected.length, 16);
    for (const id of selected) {
      assert.ok(!seen.has(id));
      seen.add(id);
      confirm(db, id);
    }
  }
  assert.equal(seen.size, 80);
  assert.deepEqual(await pendingDiscordOperations(db, now, 100), []);
  db.raw.prepare("DELETE FROM provider_operation_receipts WHERE operation_id='p00001'").run();
  const revisited = [];
  for (let page = 0; page < 5; page++)
    revisited.push(...(await pendingDiscordOperations(db, now, 100)));
  assert.deepEqual(revisited, ['p00001']);
});

void test('overlapping selectors claim different pages atomically', async (t) => {
  const db = memoryDb();
  t.after(() => db.raw.close());
  queuedPeople(db, 80, false);
  const pages = await Promise.all([
    pendingDiscordOperations(db, now, 100),
    pendingDiscordOperations(db, now, 100),
  ]);
  assert.equal(pages[0].length, 16);
  assert.equal(pages[1].length, 16);
  assert.equal(new Set(pages.flat()).size, 32);
});
