import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMigrations } from './support/db';
import { mergeFixture } from './support/merge-fixture';
void test('the retention upgrade preserves every existing row, pending removal intent, receipt and reversible merge', async () => {
  const f = await mergeFixture('0024_person_erasure.sql');
  assert.equal((await f.mergePeople(f.db, f.actor, f.input)).kind, 'ok');
  await f.people.linkIdentity(f.survivor.id, {
    platform: 'discord',
    externalId: '222222222222222222',
    linkMethod: 'self_linked',
  });
  const identity = String(
    f.db.raw.prepare("SELECT id FROM identities WHERE platform='discord'").get()?.id,
  );
  f.db.raw
    .prepare(
      "INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,created_at,updated_at,next_attempt_at) VALUES('pending','person_reconcile',?,'person',1,'{}','2026-01-01','2026-01-01','2026-01-01')",
    )
    .run(f.survivor.id);
  f.db.raw.exec(
    "INSERT INTO provider_operation_receipts VALUES('pending','discord','retry','provider_unavailable','revision','token','2026-01-01','2026-01-01')",
  );
  f.db.raw
    .prepare(
      "INSERT INTO discord_profiles VALUES(?,'111111111111111111','username','Display name','avatar','nickname',1,0,'2026-01-01','2026-01-01')",
    )
    .run(identity);
  f.db.raw
    .prepare(
      "INSERT INTO provider_access_intents VALUES('intent','discord','pending',?,?,'222222222222222222','111111111111111111','333333333333333333','person',1,'revision',1,0,'person_deleted',NULL,'2026-01-01')",
    )
    .run(f.survivor.id, identity);
  const tables = f.db.raw
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name<>'d1_migrations'")
    .all()
    .map((r) => String(r.name));
  const before = tables.map((table) => f.db.raw.prepare(`SELECT * FROM "${table}"`).all());
  applyMigrations(f.db.raw);
  const after = tables.map((table) => f.db.raw.prepare(`SELECT * FROM "${table}"`).all());
  const comparable = after.map((rows, index) =>
    tables[index] === 'consent_records'
      ? rows.map(({ origin_identity_id: _identity, import_run_id: _run, ...row }) => row)
      : rows,
  );
  assert.equal(JSON.stringify(comparable), JSON.stringify(before));
  assert.equal(
    f.db.raw
      .prepare(
        'SELECT count(*) AS n FROM consent_records WHERE origin_identity_id IS NOT NULL OR import_run_id IS NOT NULL',
      )
      .get()?.n,
    0,
  );
  assert.deepEqual(f.db.raw.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(
    (
      await f.undoMerge(f.db, f.actor, {
        mergeId: String(f.db.raw.prepare('SELECT id FROM merges').get()?.id),
        reason: 'Separate after upgrade',
        operationId: 'upgraded-undo',
      })
    ).kind,
    'ok',
  );
  assert.equal((await f.people.getPerson(f.merged.id))?.phone, '+17025550100');
  // These are the restored live business triggers, not triggers rewritten to
  // the opaque key table during SQLite's parent-table rename.
  await f.people.withdrawConsent(f.merged.id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: '2026-10-09T12:00:00.000Z',
  });
  assert.equal((await f.people.getPerson(f.merged.id))?.membership_status, 'former_member');
  assert.throws(
    () => f.db.raw.prepare('DELETE FROM staff_administrators WHERE person_id=?').run(f.admin.id),
    /last_staff_administrator/,
  );
  assert.throws(() => f.db.raw.exec("UPDATE staff_audits SET actor_id='forged'"), /audits cannot/);
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM provider_access_intents WHERE id='intent'").get()
      ?.n,
    1,
  );
  f.db.raw.close();
});
