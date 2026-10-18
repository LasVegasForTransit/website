import assert from 'node:assert/strict';
import test from 'node:test';
import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db } from '../src/db';
import { PersonService } from '../src/person-service';
import { createSession } from '../src/auth';
import { loadActor } from '../src/staff-roles';
import { memoryDb } from './support/db';

async function fixture() {
  const feature = await import('../src/staff-deletion').catch(() => null);
  assert.ok(feature, 'administrators need a guarded member deletion service');
  const db = memoryDb();
  const people = new PersonService(db);
  const member = async (name: string) =>
    (
      await people.upsertFromSource({
        source: 'join_form',
        fields: { email: `${name}@example.invalid`, given_name: name },
        consent: {
          scope: 'newsletter',
          source: 'join_form',
          method: 'checkbox',
          wordingVersion: 'fixture',
        },
      })
    ).person;
  const admin = await member('admin'),
    target = await member('target'),
    other = await member('other');
  db.raw
    .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
    .run(admin.id, 'fixture', new Date().toISOString());
  const actor = await loadActor(db, admin.id);
  assert.ok(actor);
  const input = { operationId: ulid(), expectedUpdatedAt: target.updated_at };
  return { ...feature, db, people, member, admin, target, other, actor, input };
}

void test('staff deletion erases only the selected member, revokes sessions and preserves cleanup work and a trusted receipt', async () => {
  const { db, people, target, other, actor, input, deleteStaffPerson } = await fixture();
  for (const [platform, externalId] of [
    ['beehiiv', 'newsletter-target'],
    ['google_workspace', 'google-target'],
    ['discord', 'discord-target'],
  ] as const)
    await people.linkIdentity(target.id, {
      platform,
      externalId,
      externalEmail: target.email ?? '',
      linkMethod: 'self_linked',
    });
  await createSession(
    { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-only' },
    target.id,
    'member',
  );
  const current = await people.getPerson(target.id);
  assert.ok(current);
  assert.equal(
    (
      await deleteStaffPerson(db, actor, target.id, {
        ...input,
        expectedUpdatedAt: current.updated_at,
      })
    ).kind,
    'ok',
  );
  const erased = db.raw
    .prepare('SELECT given_name,email,deleted_at,erased_at FROM people WHERE id=?')
    .get(target.id);
  assert.ok(erased);
  assert.equal(erased.given_name, null);
  assert.equal(erased.email, null);
  assert.ok(erased.deleted_at && erased.erased_at);
  for (const table of [
    'sessions',
    'consent_records',
    'consent_withdrawals',
    'committee_assignments',
  ])
    assert.equal(
      db.raw.prepare(`SELECT count(*) AS n FROM ${table} WHERE person_id=?`).get(target.id)?.n,
      0,
      table,
    );
  const receipt = db.raw
    .prepare(
      'SELECT requested_by,operation_id,requested_at,completed_at FROM person_deletion_log WHERE person_id=?',
    )
    .get(target.id);
  assert.ok(receipt);
  assert.equal(receipt.requested_by, actor.personId);
  assert.equal(receipt.operation_id, input.operationId);
  assert.ok(receipt.requested_at && receipt.completed_at);
  assert.equal(
    db.raw
      .prepare(
        'SELECT count(*) AS n FROM workspace_offboarding_queue WHERE person_id=? AND reviewed_at IS NULL',
      )
      .get(target.id)?.n,
    1,
  );
  assert.equal(
    db.raw.prepare('SELECT state FROM newsletter_sync_jobs WHERE person_id=?').get(target.id)
      ?.state,
    'queued',
  );
  assert.ok(
    db.raw
      .prepare("SELECT 1 FROM integration_outbox WHERE person_id=? AND state='queued'")
      .get(target.id),
  );
  assert.equal((await people.getPerson(other.id))?.email, 'other@example.invalid');
  assert.equal(
    db.raw.prepare('SELECT count(*) AS n FROM person_deletion_log WHERE person_id=?').get(other.id)
      ?.n,
    0,
  );
});

void test('confirmation identifies Google accounts and combined records without loading their history', async () => {
  const { db, people, target, actor, staffDeletionView } = await fixture();
  const plain = await staffDeletionView(db, actor, target.id);
  assert.ok(plain);
  assert.equal(plain.has_google_account, 0);
  assert.equal(plain.has_combined_records, 0);
  await people.linkIdentity(target.id, {
    platform: 'google_workspace',
    externalId: 'confirmation-google',
    linkMethod: 'self_linked',
  });
  const linked = await staffDeletionView(db, actor, target.id);
  assert.ok(linked);
  assert.equal(linked.has_google_account, 1);
  assert.equal(linked.has_combined_records, 0);
});

void test('free-text operation keys cannot put personal data in a permanent deletion receipt', async () => {
  const { db, target, actor, input, deleteStaffPerson } = await fixture();
  assert.equal(
    (
      await deleteStaffPerson(db, actor, target.id, {
        ...input,
        operationId: 'target@example.invalid',
      })
    ).kind,
    'invalid',
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM person_deletion_log').get()?.n, 0);
  assert.equal(
    db.raw.prepare('SELECT email FROM people WHERE id=?').get(target.id)?.email,
    'target@example.invalid',
  );
});

void test('current administrator authority and selected-record version are required, including inside the deletion transaction', async () => {
  for (const change of ['stale', 'revoked'] as const) {
    const { db, target, actor, input, deleteStaffPerson } = await fixture();
    const raced: Db = {
      prepare: (sql) => db.prepare(sql),
      batch: async (statements) => {
        if (change === 'stale')
          db.raw
            .prepare(
              "UPDATE people SET updated_at='2099-01-01T00:00:00Z',given_name='Newer name' WHERE id=?",
            )
            .run(target.id);
        else
          db.raw
            .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
            .run(actor.personId);
        return await db.batch(statements);
      },
    };
    assert.equal(
      (await deleteStaffPerson(raced, actor, target.id, input)).kind,
      change === 'stale' ? 'conflict' : 'forbidden',
    );
    assert.equal(
      db.raw.prepare('SELECT erased_at FROM people WHERE id=?').get(target.id)?.erased_at,
      null,
    );
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM person_deletion_log').get()?.n, 0);
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM newsletter_address_tombstones').get()?.n,
      0,
    );
  }
});

void test('leads and forged administrator facts cannot load or delete a member, and missing versions are rejected', async () => {
  const { db, target, other, actor, input, deleteStaffPerson, staffDeletionView } = await fixture();
  const forged = { ...actor, personId: other.id };
  assert.equal(await staffDeletionView(db, forged, target.id), null);
  assert.equal((await deleteStaffPerson(db, forged, target.id, input)).kind, 'forbidden');
  assert.equal(
    (await deleteStaffPerson(db, actor, target.id, { ...input, expectedUpdatedAt: '' })).kind,
    'invalid',
  );
  assert.equal(
    db.raw.prepare('SELECT erased_at FROM people WHERE id=?').get(target.id)?.erased_at,
    null,
  );
});

void test('the last active administrator is protected even when another designation belongs to a former member', async () => {
  const { db, admin, other, actor, input, deleteStaffPerson } = await fixture();
  db.raw
    .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
    .run(other.id, 'fixture', new Date().toISOString());
  db.raw.prepare("UPDATE people SET membership_status='former_member' WHERE id=?").run(other.id);
  const result = await deleteStaffPerson(db, actor, admin.id, {
    ...input,
    expectedUpdatedAt: admin.updated_at,
  });
  assert.equal(result.kind, 'last_admin');
  assert.equal(
    db.raw.prepare('SELECT erased_at FROM people WHERE id=?').get(admin.id)?.erased_at,
    null,
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM person_deletion_log').get()?.n, 0);
});

void test('a simultaneous loss of the backup administrator cannot erase the last active administrator', async () => {
  const { db, admin, other, actor, input, deleteStaffPerson } = await fixture();
  db.raw
    .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
    .run(other.id, 'fixture', new Date().toISOString());
  const raced: Db = {
    prepare: (sql) => db.prepare(sql),
    batch: async (statements) => {
      db.raw
        .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
        .run(other.id);
      return await db.batch(statements);
    },
  };
  assert.equal(
    (
      await deleteStaffPerson(raced, actor, admin.id, {
        ...input,
        expectedUpdatedAt: admin.updated_at,
      })
    ).kind,
    'last_admin',
  );
  assert.equal(
    db.raw.prepare('SELECT erased_at FROM people WHERE id=?').get(admin.id)?.erased_at,
    null,
  );
});

void test('replay keeps the original receipt and an operation cannot be reused to delete a different member', async () => {
  const { db, target, other, actor, input, deleteStaffPerson } = await fixture();
  assert.equal((await deleteStaffPerson(db, actor, target.id, input)).kind, 'ok');
  const before = db.raw
    .prepare('SELECT * FROM person_deletion_log WHERE person_id=?')
    .get(target.id);
  assert.equal((await deleteStaffPerson(db, actor, target.id, input)).kind, 'ok');
  assert.deepEqual(
    db.raw.prepare('SELECT * FROM person_deletion_log WHERE person_id=?').get(target.id),
    before,
  );
  assert.equal(
    (
      await deleteStaffPerson(db, actor, other.id, {
        ...input,
        expectedUpdatedAt: other.updated_at,
      })
    ).kind,
    'conflict',
  );
  assert.equal(
    db.raw.prepare('SELECT erased_at FROM people WHERE id=?').get(other.id)?.erased_at,
    null,
  );
});

void test('a cleanup failure rolls back personal erasure, receipts and provider retry work', async () => {
  const { db, target, actor, input, deleteStaffPerson } = await fixture();
  db.raw.exec(
    "CREATE TRIGGER fixture_failure BEFORE DELETE ON consent_records BEGIN SELECT RAISE(ABORT,'fixture_cleanup_failure'); END",
  );
  await assert.rejects(deleteStaffPerson(db, actor, target.id, input), /fixture_cleanup_failure/);
  assert.equal(
    db.raw.prepare('SELECT email,erased_at FROM people WHERE id=?').get(target.id)?.email,
    'target@example.invalid',
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM person_deletion_log').get()?.n, 0);
  assert.equal(
    db.raw.prepare('SELECT count(*) AS n FROM newsletter_address_tombstones').get()?.n,
    0,
  );
});
