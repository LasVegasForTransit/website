import assert from 'node:assert/strict';
import test from 'node:test';
import { pendingDiscordOperations } from '../src/discord-pending';
import { markOperationFailed } from '../src/outbox';
import { loadActor } from '../src/staff-roles';
import { accessFixture } from './support/access-fixture';

async function fixture(t: test.TestContext) {
  const f = await accessFixture();
  t.after(() => f.db.raw.close());
  const stamp = new Date().toISOString();
  await markOperationFailed(f.db, 'grant', 'provider_unavailable');
  f.db.raw.exec(`INSERT INTO integration_outbox
    (id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at)
    SELECT 'unrelated',kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at
    FROM integration_outbox WHERE id='grant'`);
  for (const [operation, provider] of [
    ['grant', 'discord'],
    ['grant', 'google_workspace'],
    ['unrelated', 'discord'],
  ] as const)
    f.db.raw
      .prepare(
        `INSERT INTO provider_operation_receipts
        (operation_id,provider,state,revision_hash,lease_token,observed_at,expires_at)
        VALUES(?,?,'done','revision','lease',?,?)`,
      )
      .run(operation, provider, stamp, new Date(Date.parse(stamp) + 300_000).toISOString());
  f.db.raw
    .prepare(
      `INSERT INTO provider_account_leases(provider,context_id,identity_id,token,expires_at)
      VALUES('discord','guild','123','active-lease',?)`,
    )
    .run(new Date(Date.parse(stamp) + 30_000).toISOString());
  assert.equal(await f.recordAccessObservation(f.db, f.observation), true);
  return f;
}

function receipts(f: Awaited<ReturnType<typeof fixture>>) {
  return f.db.raw
    .prepare('SELECT * FROM provider_operation_receipts ORDER BY operation_id,provider')
    .all();
}

void test('an accepted staff retry immediately rechecks Discord while preserving other proof and leases', async (t) => {
  const f = await fixture(t);
  const before = receipts(f);
  const leases = f.db.raw.prepare('SELECT * FROM provider_account_leases').all();
  const observations = f.db.raw.prepare('SELECT * FROM access_observations').all();
  const audits = f.db.raw.prepare('SELECT * FROM staff_audits').all();
  assert.equal((await f.requestAccessRetry(f.db, f.actor, 'grant')).kind, 'ok');
  assert.deepEqual(await pendingDiscordOperations(f.db, new Date(), 1), ['grant']);
  assert.deepEqual(
    receipts(f),
    before.filter((row) => row.operation_id !== 'grant' || row.provider !== 'discord'),
  );
  assert.deepEqual(f.db.raw.prepare('SELECT * FROM provider_account_leases').all(), leases);
  assert.deepEqual(f.db.raw.prepare('SELECT * FROM access_observations').all(), observations);
  for (const audit of audits) {
    assert.ok(typeof audit.id === 'string');
    assert.deepEqual(
      f.db.raw.prepare('SELECT * FROM staff_audits WHERE id=?').get(audit.id),
      audit,
    );
  }
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM staff_audits WHERE action='access.retry'").get()?.n,
    1,
  );
});

void test('an accepted staff retry preserves its existing failed Discord receipt', async (t) => {
  const f = await fixture(t);
  f.db.raw
    .prepare(
      "UPDATE provider_operation_receipts SET state='retry',failure='provider_unavailable' WHERE operation_id='grant' AND provider='discord'",
    )
    .run();
  const before = receipts(f);
  assert.equal((await f.requestAccessRetry(f.db, f.actor, 'grant')).kind, 'ok');
  assert.deepEqual(receipts(f), before);
  assert.deepEqual(await pendingDiscordOperations(f.db, new Date(), 1), ['grant']);
});

for (const reason of ['denied', 'revoked', 'stale', 'already_queued', 'audit_failure']) {
  void test(`staff retry rejected for ${reason} preserves successful provider receipts`, async (t) => {
    const f = await fixture(t);
    f.db.raw
      .prepare(
        `INSERT INTO staff_audits(id,actor_id,action,target_id,details,occurred_at)
        VALUES('older-retry',?,'access.retry',?,'{"targetId":"events","reason":"staff_retry"}',?)`,
      )
      .run(f.actor.personId, f.survivor.id, new Date().toISOString());
    const before = receipts(f);
    let database = f.db;
    let actor = f.actor;
    if (reason === 'denied') {
      const member = await loadActor(f.db, f.survivor.id);
      assert.ok(member);
      actor = member;
    }
    if (reason === 'revoked') {
      f.db.raw
        .prepare(
          'INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES(?,?,?)',
        )
        .run(f.survivor.id, 'fixture', new Date().toISOString());
      database = {
        ...f.db,
        batch: async (statements) => {
          f.db.raw
            .prepare('DELETE FROM staff_administrators WHERE person_id=?')
            .run(f.actor.personId);
          return await f.db.batch(statements);
        },
      };
    }
    if (reason === 'stale')
      f.db.raw
        .prepare(
          "UPDATE reconcile_generations SET generation=generation+1 WHERE person_id=? AND target_id='events'",
        )
        .run(f.survivor.id);
    if (reason === 'already_queued')
      f.db.raw.prepare("UPDATE integration_outbox SET state='queued' WHERE id='grant'").run();
    if (reason === 'audit_failure') {
      f.db.raw.exec(`CREATE TRIGGER reject_retry_receipt_test BEFORE INSERT ON staff_audits
        WHEN NEW.action='access.retry' BEGIN SELECT RAISE(ABORT,'retry audit rejected'); END`);
      await assert.rejects(f.requestAccessRetry(database, actor, 'grant'), /retry audit rejected/);
      assert.equal(
        f.db.raw.prepare("SELECT state FROM integration_outbox WHERE id='grant'").get()?.state,
        'retry',
      );
    } else {
      assert.equal(
        (await f.requestAccessRetry(database, actor, 'grant')).kind,
        reason === 'denied' ? 'forbidden' : 'conflict',
      );
    }
    assert.deepEqual(receipts(f), before);
    assert.equal(
      f.db.raw.prepare("SELECT count(*) AS n FROM staff_audits WHERE action='access.retry'").get()
        ?.n,
      1,
    );
  });
}
