import assert from 'node:assert/strict';
import test from 'node:test';
import type { Db } from '../src/db';
import { requestCode } from '../src/auth';
import { PersonService } from '../src/person-service';
import { bootstrapStaffAdmin, loadActor } from '../src/staff-roles';
import { CommitteeService } from '../src/committees';
import { linkWorkspaceIdentity, createWorkspaceSession } from '../src/workspace-link';
import { memoryDb } from './support/db';
async function fixture() {
  const loaded = await import('../src/corrections').catch(() => null);
  assert.ok(loaded, 'staff corrections require atomic attributed changes');
  const db = memoryDb();
  const people = new PersonService(db);
  const member = async (email: string) =>
    (
      await people.upsertFromSource({
        source: 'join_form',
        fields: { email, given_name: 'Original' },
        consent: {
          scope: 'newsletter',
          source: 'join_form',
          method: 'checkbox',
          wordingVersion: 'fixture',
        },
      })
    ).person;
  const admin = await member('admin@example.invalid');
  const target = await member('member@example.invalid');
  const workspace = {
    subject: 'admin-google',
    email: 'admin@lasvegasfortransit.org',
    givenName: null,
    familyName: null,
  };
  await linkWorkspaceIdentity(db, {
    workspace,
    personId: admin.id,
    method: 'self_linked',
    operationId: 'link-admin',
  });
  await bootstrapStaffAdmin(db, {
    presidentPersonId: admin.id,
    workspaceSubject: workspace.subject,
    performedBy: 'fixture',
    operationId: 'bootstrap',
  });
  const actor = await loadActor(db, admin.id);
  assert.ok(actor);
  return { ...loaded, db, people, admin, target, actor, member, workspace };
}
void test('corrections require a reason and current administrator authority, and cannot change membership or consent', async () => {
  const { db, correctPerson, target, actor, member } = await fixture();
  for (const input of [
    { fields: { given_name: 'Changed' }, reason: '', operationId: 'empty-reason' },
    { fields: { membership_status: 'member' }, reason: 'Correction', operationId: 'membership' },
    { fields: { preferred_language: null }, reason: 'Correction', operationId: 'bad-language' },
    { fields: { zip: 'abc' }, reason: 'Correction', operationId: 'bad-zip' },
    { fields: { email: 'bad-email' }, reason: 'Correction', operationId: 'bad-email' },
  ]) {
    assert.equal(
      (await correctPerson(db, actor, target.id, input as Parameters<typeof correctPerson>[3]))
        .kind,
      'invalid',
    );
  }
  const lead = await member('lead@example.invalid');
  await new CommitteeService(db).assign({
    actorId: actor.personId,
    personId: lead.id,
    committeeId: 'events',
    role: 'lead',
    operationId: 'lead',
  });
  assert.equal(
    (
      await correctPerson(db, { ...actor, personId: lead.id }, target.id, {
        fields: { given_name: 'Changed' },
        reason: 'Correction',
        operationId: 'forged',
      })
    ).kind,
    'forbidden',
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM person_corrections').get()?.n, 0);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 3);
  assert.equal(
    db.raw.prepare('SELECT given_name FROM people WHERE id=?').get(target.id)?.given_name,
    'Original',
  );
});
void test('one correction records old/new fields and sources, attributed history and a current outbox generation; replay is exact', async () => {
  const { db, correctPerson, target, actor, people } = await fixture();
  const input = {
    fields: { given_name: 'Corrected', phone: '(702) 555-0100' },
    reason: 'Member supplied their correct details.',
    operationId: 'correction',
  };
  const first = await correctPerson(db, actor, target.id, input);
  assert.equal(first.kind, 'ok');
  assert.equal((await people.getPerson(target.id))?.phone, '+17025550100');
  assert.equal((await people.getPerson(target.id))?.membership_status, 'member');
  const correction = db.raw.prepare('SELECT actor_id,reason,changes FROM person_corrections').get();
  assert.ok(correction);
  assert.equal(correction.actor_id, actor.personId);
  assert.equal(correction.reason, input.reason);
  assert.deepEqual(JSON.parse(String(correction.changes)), [
    { field: 'given_name', before: 'Original', after: 'Corrected', beforeSource: 'join_form' },
    { field: 'phone', before: null, after: '+17025550100', beforeSource: null },
  ]);
  const event = db.raw
    .prepare("SELECT details FROM engagement_events WHERE type='correction'")
    .get();
  assert.equal((JSON.parse(String(event?.details)) as { actorId: string }).actorId, actor.personId);
  assert.equal(
    db.raw
      .prepare("SELECT source FROM field_sources WHERE person_id=? AND field='given_name'")
      .get(target.id)?.source,
    'staff',
  );
  assert.deepEqual(
    await correctPerson(db, actor, target.id, {
      ...input,
      fields: { phone: '+17025550100', given_name: 'Corrected' },
    }),
    first,
  );
  assert.equal(
    (await correctPerson(db, actor, target.id, { ...input, reason: 'Different payload' })).kind,
    'conflict',
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM person_corrections').get()?.n, 1);
  assert.equal(
    db.raw
      .prepare("SELECT count(*) AS n FROM integration_outbox WHERE kind='person_reconcile'")
      .get()?.n,
    1,
  );
  assert.equal(
    db.raw
      .prepare('SELECT generation FROM reconcile_generations WHERE person_id=? AND target_id=?')
      .get(target.id, 'person')?.generation,
    1,
  );
});
void test('email uniqueness conflicts roll back everything; an actual email change clears verification, codes and sessions', async () => {
  const { db, correctPerson, target, actor, workspace, admin } = await fixture();
  const session = await createWorkspaceSession(
    { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-only' },
    workspace,
  );
  assert.ok(session);
  const code = await requestCode(
    { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-only' },
    { email: admin.email ?? '', purpose: 'sign_in', callerAddress: 'fixture-only' },
  );
  assert.equal(code.kind, 'issued');

  db.raw
    .prepare('UPDATE people SET email_verified_at=? WHERE id=?')
    .run('2026-01-01T00:00:00Z', admin.id);
  const conflict = await correctPerson(db, actor, target.id, {
    fields: { email: 'ADMIN@example.invalid', given_name: 'Should not change' },
    reason: 'Email correction',
    operationId: 'duplicate-email',
  });
  assert.equal(conflict.kind, 'conflict');
  assert.equal(
    db.raw.prepare('SELECT given_name FROM people WHERE id=?').get(target.id)?.given_name,
    'Original',
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM person_corrections').get()?.n, 0);
  const success = await correctPerson(db, actor, admin.id, {
    fields: { email: 'new@example.invalid' },
    reason: 'Personal email changed',
    operationId: 'new-email',
  });
  assert.equal(success.kind, 'ok');
  assert.equal(
    db.raw.prepare('SELECT email_verified_at FROM people WHERE id=?').get(admin.id)
      ?.email_verified_at,
    null,
  );
  assert.equal(
    db.raw.prepare('SELECT count(*) AS n FROM sessions WHERE person_id=?').get(admin.id)?.n,
    0,
  );
  assert.equal(
    db.raw.prepare('SELECT count(*) AS n FROM sign_in_codes WHERE person_id=?').get(admin.id)?.n,
    0,
  );

  assert.equal(
    db.raw
      .prepare(
        "SELECT count(*) AS n FROM identities WHERE person_id=? AND platform='google_workspace'",
      )
      .get(admin.id)?.n,
    1,
  );
});
void test('ZIP correction clears derived geography, newer edits supersede queued reconciliation, and fault injection is atomic', async () => {
  const { db, correctPerson, target, actor } = await fixture();
  db.raw
    .prepare(
      "UPDATE people SET zip='89101',census_block='320030001001001',census_block_vintage='2020',place_name='Las Vegas',region_id='downtown',region_source='zip',region_set_at='2026-01-01' WHERE id=?",
    )
    .run(target.id);
  const zip = await correctPerson(db, actor, target.id, {
    fields: { zip: '89104' },
    reason: 'Updated ZIP',
    operationId: 'zip',
  });
  assert.equal(zip.kind, 'ok');
  const location = db.raw
    .prepare('SELECT census_block,place_name,region_id FROM people WHERE id=?')
    .get(target.id);
  assert.deepEqual({ ...location }, { census_block: null, place_name: null, region_id: null });
  db.raw.exec(
    "CREATE TRIGGER fail_correction BEFORE INSERT ON engagement_events WHEN NEW.type='correction' BEGIN SELECT RAISE(ABORT,'fixture_failure'); END",
  );
  const next = { fields: { given_name: 'Next' }, reason: 'Updated name', operationId: 'next' };
  await assert.rejects(correctPerson(db, actor, target.id, next), /fixture_failure/);
  assert.equal(
    db.raw.prepare('SELECT given_name FROM people WHERE id=?').get(target.id)?.given_name,
    'Original',
  );
  assert.equal(
    db.raw.prepare("SELECT 1 FROM staff_operations WHERE operation_id='next'").get(),
    undefined,
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM person_corrections').get()?.n, 1);
  db.raw.exec('DROP TRIGGER fail_correction');
  assert.equal((await correctPerson(db, actor, target.id, next)).kind, 'ok');
  assert.equal(
    db.raw
      .prepare('SELECT generation FROM reconcile_generations WHERE person_id=? AND target_id=?')
      .get(target.id, 'person')?.generation,
    2,
  );
});

void test('ZIP correction preserves an explicitly chosen region', async () => {
  const { db, correctPerson, target, actor } = await fixture();
  for (const [index, source] of ['staff', 'member_choice'].entries()) {
    db.raw
      .prepare(
        "UPDATE people SET region_id='downtown',region_source=?,region_set_at='2026-01-01' WHERE id=?",
      )
      .run(source, target.id);
    assert.equal(
      (
        await correctPerson(db, actor, target.id, {
          fields: { zip: index === 0 ? '89101' : '89104' },
          reason: 'Member corrected their ZIP',
          operationId: `region-${index}`,
        })
      ).kind,
      'ok',
    );
    assert.equal(
      db.raw.prepare('SELECT region_id FROM people WHERE id=?').get(target.id)?.region_id,
      'downtown',
    );
    assert.equal(
      db.raw.prepare('SELECT region_source FROM people WHERE id=?').get(target.id)?.region_source,
      source,
    );
  }
});
void test('authorization and original values are rechecked inside the write transaction', async () => {
  const { db, correctPerson, target, actor } = await fixture();
  const stale: Db = {
    prepare: (sql) => db.prepare(sql),
    batch: async (statements) => {
      db.raw.prepare("UPDATE people SET given_name='Newer member edit' WHERE id=?").run(target.id);
      return await db.batch(statements);
    },
  };
  assert.equal(
    (
      await correctPerson(stale, actor, target.id, {
        fields: { given_name: 'Stale overwrite' },
        reason: 'Correction',
        operationId: 'stale',
      })
    ).kind,
    'conflict',
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM person_corrections').get()?.n, 0);
  const revoked: Db = {
    prepare: (sql) => db.prepare(sql),
    batch: async (statements) => {
      db.raw
        .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
        .run(actor.personId);
      return await db.batch(statements);
    },
  };
  assert.equal(
    (
      await correctPerson(revoked, actor, target.id, {
        fields: { given_name: 'Denied overwrite' },
        reason: 'Correction',
        operationId: 'revoked',
      })
    ).kind,
    'forbidden',
  );
  assert.equal(
    db.raw.prepare('SELECT given_name FROM people WHERE id=?').get(target.id)?.given_name,
    'Newer member edit',
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM person_corrections').get()?.n, 0);
});
