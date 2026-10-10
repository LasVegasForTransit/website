import assert from 'node:assert/strict';
import test from 'node:test';
import type { Db } from '../src/db';
import { correctPerson } from '../src/corrections';
import { getStaffPerson } from '../src/staff-people';
import { operationIsCurrent } from '../src/outbox';
import { mergeFixture } from './support/merge-fixture';

void test('merge moves every related row by ID, preserves immutable history, invalidates access and queues both current reconciliations', async () => {
  const f = await mergeFixture();
  const { db, actor, survivor, merged, input, people, mergePeople } = f;
  await people.linkIdentity(merged.id, {
    platform: 'discord',
    externalId: 'discord-original',
    linkMethod: 'staff_confirmed',
  });
  const assignment = await f.committees.assign({
    personId: merged.id,
    committeeId: 'events',
    role: 'member',
    actorId: actor.personId,
    operationId: 'assignment',
  });
  assert.equal(assignment.kind, 'ok');
  await correctPerson(db, actor, merged.id, {
    fields: { family_name: 'Corrected' },
    reason: 'Member supplied name',
    operationId: 'correct-original',
  });
  db.raw
    .prepare('INSERT INTO form_submissions VALUES (?,?,?,?)')
    .run('form-token', merged.id, '2026-01-01', '2026-01-01');
  db.raw
    .prepare('INSERT INTO workspace_link_operations VALUES (?,?,?,?)')
    .run('historical-link', merged.id, 'historical-subject', '2026-01-01');
  db.raw
    .prepare(
      'INSERT INTO sessions(id_hash,person_id,type,created_at,last_used_at,expires_at,updated_at) VALUES (?,?,?, ?,?,?,?)',
    )
    .run(
      'session-fixture',
      merged.id,
      'member',
      '2026-01-01',
      '2026-01-01',
      '2099-01-01',
      '2026-01-01',
    );
  db.raw
    .prepare('INSERT INTO welcome_claims VALUES (?,?,?,?,?)')
    .run('welcome-original', merged.id, actor.personId, '2026-01-01', '2099-01-01');
  const eventBefore = db.raw
    .prepare('SELECT * FROM engagement_events WHERE person_id=? ORDER BY id')
    .all(merged.id);
  const first = await mergePeople(db, actor, input);
  assert.equal(first.kind, 'ok');
  assert.equal(await people.getPerson(merged.id), null);
  assert.equal((await people.getPerson(survivor.id))?.phone, '+17025550100');
  for (const table of [
    'consent_records',
    'identities',
    'engagement_events',
    'committee_assignments',
    'person_corrections',
    'form_submissions',
    'workspace_link_operations',
  ]) {
    assert.equal(
      db.raw.prepare(`SELECT count(*) AS n FROM ${table} WHERE person_id=?`).get(merged.id)?.n,
      0,
      table,
    );
  }
  for (const event of eventBefore) {
    const after = db.raw
      .prepare('SELECT * FROM engagement_events WHERE id=?')
      .get(String(event.id));
    assert.deepEqual({ ...after, person_id: merged.id }, { ...event });
  }
  assert.throws(
    () =>
      db.raw
        .prepare("UPDATE engagement_events SET source='forged' WHERE person_id=?")
        .run(survivor.id),
    /cannot be changed/,
  );
  assert.throws(
    () =>
      db.raw
        .prepare("UPDATE person_corrections SET reason='forged' WHERE person_id=?")
        .run(survivor.id),
    /cannot be changed/,
  );
  assert.equal(
    db.raw
      .prepare('SELECT count(*) AS n FROM sessions WHERE person_id IN (?,?)')
      .get(survivor.id, merged.id)?.n,
    0,
  );
  assert.equal(
    db.raw
      .prepare('SELECT count(*) AS n FROM welcome_claims WHERE person_id IN (?,?)')
      .get(survivor.id, merged.id)?.n,
    0,
  );
  assert.equal((await getStaffPerson(db, actor, merged.id))?.person.id, survivor.id);
  assert.deepEqual(await mergePeople(db, actor, input), first);
  assert.equal(
    (await mergePeople(db, actor, { ...input, reason: 'Changed request' })).kind,
    'conflict',
  );
  const jobs = db.raw
    .prepare(
      "SELECT id,person_id FROM integration_outbox WHERE kind='person_reconcile' AND json_extract(payload,'$.mergeId') IS NOT NULL",
    )
    .all();
  assert.equal(jobs.length, 2);
  for (const job of jobs) assert.equal(await operationIsCurrent(db, String(job.id)), true);
});

void test('conflicting emails, accounts and current committee assignments never partially combine', async () => {
  for (const conflict of ['email', 'identity', 'assignment']) {
    const f = await mergeFixture();
    if (conflict === 'email')
      await f.people.updateFields(f.merged.id, {
        source: 'staff',
        fields: { email: 'different@example.invalid' },
      });
    if (conflict === 'identity')
      for (const [id, externalId] of [
        [f.survivor.id, 'one'],
        [f.merged.id, 'two'],
      ] as const)
        await f.people.linkIdentity(id, {
          platform: 'discord',
          externalId,
          linkMethod: 'staff_confirmed',
        });
    if (conflict === 'assignment')
      for (const personId of [f.survivor.id, f.merged.id])
        await f.committees.assign({
          personId,
          committeeId: 'events',
          role: 'member',
          actorId: f.actor.personId,
          operationId: personId,
        });
    const before = f.db.raw.prepare('SELECT * FROM people ORDER BY id').all();
    assert.equal((await f.mergePeople(f.db, f.actor, f.input)).kind, 'conflict', conflict);
    assert.deepEqual(f.db.raw.prepare('SELECT * FROM people ORDER BY id').all(), before);
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM merges').get()?.n, 0);
    assert.equal(
      f.db.raw
        .prepare('SELECT 1 FROM staff_operations WHERE operation_id=?')
        .get(f.input.operationId),
      undefined,
    );
  }
});

void test('merge requires a reason and current authority, and rechecks intervening changes in its transaction', async () => {
  const f = await mergeFixture();
  assert.equal((await f.mergePeople(f.db, f.actor, { ...f.input, reason: '' })).kind, 'invalid');
  assert.equal(
    (await f.mergePeople(f.db, { ...f.actor, personId: f.survivor.id }, f.input)).kind,
    'forbidden',
  );
  const raced: Db = {
    prepare: (sql) => f.db.prepare(sql),
    batch: async (statements) => {
      await f.people.recordEngagement(f.merged.id, {
        type: 'welcomed',
        source: 'staff',
        occurredAt: '2026-10-04T10:00:00Z',
        reference: 'new-during-merge',
      });
      return f.db.batch(statements);
    },
  };
  assert.equal((await f.mergePeople(raced, f.actor, f.input)).kind, 'conflict');
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM merges').get()?.n, 0);
  const revoked: Db = {
    prepare: (sql) => f.db.prepare(sql),
    batch: async (statements) => {
      f.db.raw
        .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
        .run(f.actor.personId);
      return f.db.batch(statements);
    },
  };
  assert.equal((await f.mergePeople(revoked, f.actor, f.input)).kind, 'forbidden');
  assert.ok(await f.people.getPerson(f.merged.id));
});

void test('a newer withdrawal wins over older active consent when combining people', async () => {
  const f = await mergeFixture();
  await f.people.withdrawConsent(f.survivor.id, {
    scope: 'newsletter',
    source: 'beehiiv',
    withdrawnAt: '2090-01-01T00:00:00Z',
  });
  assert.equal((await f.mergePeople(f.db, f.actor, f.input)).kind, 'ok');
  assert.equal((await f.people.getPerson(f.survivor.id))?.membership_status, 'former_member');
  assert.equal(
    f.db.raw
      .prepare(
        "SELECT count(*) AS n FROM consent_records WHERE person_id=? AND scope='newsletter' AND withdrawn_at IS NULL",
      )
      .get(f.survivor.id)?.n,
    0,
  );
});
