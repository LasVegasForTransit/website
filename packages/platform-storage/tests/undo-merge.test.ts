import assert from 'node:assert/strict';
import test from 'node:test';
import type { Db } from '../src/db';
import { correctPerson } from '../src/corrections';
import { getStaffPerson } from '../src/staff-people';
import { mergeFixture } from './support/merge-fixture';

void test('undo restores only moved entries and keeps later edits, welcomes and new accounts', async () => {
  const f = await mergeFixture();
  await f.people.linkIdentity(f.merged.id, {
    platform: 'discord',
    externalId: 'original-discord',
    linkMethod: 'staff_confirmed',
  });
  const before = f.db.raw
    .prepare('SELECT id FROM engagement_events WHERE person_id=?')
    .all(f.merged.id);
  const combined = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(combined.kind, 'ok');
  await correctPerson(f.db, f.actor, f.survivor.id, {
    fields: { given_name: 'Newer name' },
    reason: 'Later edit',
    operationId: 'later-correction',
  });
  const welcome = await f.people.recordEngagement(f.survivor.id, {
    type: 'welcomed',
    source: 'staff',
    occurredAt: '2091-01-01T00:00:00Z',
    reference: 'later-welcome',
  });
  await f.people.linkIdentity(f.survivor.id, {
    platform: 'luma',
    externalId: 'new-luma',
    linkMethod: 'staff_confirmed',
  });
  const undone = await f.undoMerge(f.db, f.actor, {
    mergeId: combined.value.mergeId,
    reason: 'Two people after all.',
    operationId: 'undo',
  });
  assert.equal(undone.kind, 'ok');
  assert.equal((await f.people.getPerson(f.survivor.id))?.given_name, 'Newer name');
  assert.equal((await f.people.getPerson(f.survivor.id))?.phone, null);
  assert.equal((await f.people.getPerson(f.merged.id))?.phone, '+17025550100');
  assert.equal(
    f.db.raw.prepare('SELECT person_id FROM engagement_events WHERE id=?').get(welcome)?.person_id,
    f.survivor.id,
  );
  assert.equal(
    f.db.raw.prepare("SELECT person_id FROM identities WHERE external_id='new-luma'").get()
      ?.person_id,
    f.survivor.id,
  );
  assert.equal(
    f.db.raw.prepare("SELECT person_id FROM identities WHERE external_id='original-discord'").get()
      ?.person_id,
    f.merged.id,
  );
  for (const row of before)
    assert.equal(
      f.db.raw.prepare('SELECT person_id FROM engagement_events WHERE id=?').get(String(row.id))
        ?.person_id,
      f.merged.id,
    );
  assert.deepEqual(
    await f.undoMerge(f.db, f.actor, {
      mergeId: combined.value.mergeId,
      reason: 'Two people after all.',
      operationId: 'undo',
    }),
    undone,
  );
  assert.equal((await getStaffPerson(f.db, f.actor, f.merged.id))?.person.id, f.merged.id);
});

void test('undo preserves a later withdrawal even if the merged consent was already inactive', async () => {
  const f = await mergeFixture();
  await f.people.withdrawConsent(f.survivor.id, {
    scope: 'newsletter',
    source: 'beehiiv',
    withdrawnAt: '2090-01-01T00:00:00Z',
  });
  const combined = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(combined.kind, 'ok');
  await f.people.withdrawConsent(f.survivor.id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: '2091-01-01T00:00:00Z',
  });
  assert.equal(
    (
      await f.undoMerge(f.db, f.actor, {
        mergeId: combined.value.mergeId,
        reason: 'Wrong match',
        operationId: 'undo-withdrawal',
      })
    ).kind,
    'ok',
  );
  assert.equal((await f.people.getPerson(f.merged.id))?.membership_status, 'former_member');
  assert.equal((await f.people.getPerson(f.survivor.id))?.membership_status, 'former_member');
});

void test('undo conflicts on changed copied details, ownership or deletion and never recreates removed accounts', async () => {
  for (const scenario of ['field', 'owner', 'deleted', 'removed-identity']) {
    const f = await mergeFixture();
    await f.people.linkIdentity(f.merged.id, {
      platform: 'discord',
      externalId: 'old-discord',
      linkMethod: 'staff_confirmed',
    });
    const combined = await f.mergePeople(f.db, f.actor, f.input);
    assert.equal(combined.kind, 'ok');
    if (scenario === 'field')
      await f.people.updateFields(f.survivor.id, {
        source: 'staff',
        fields: { phone: '+17025550999' },
      });
    if (scenario === 'owner')
      f.db.raw
        .prepare("UPDATE identities SET person_id=? WHERE external_id='old-discord'")
        .run(f.admin.id);
    if (scenario === 'deleted') await f.people.deletePerson(f.survivor.id);
    if (scenario === 'removed-identity')
      f.db.raw.prepare("DELETE FROM identities WHERE external_id='old-discord'").run();
    const result = await f.undoMerge(f.db, f.actor, {
      mergeId: combined.value.mergeId,
      reason: 'Wrong match',
      operationId: 'undo-conflict',
    });
    assert.equal(result.kind, scenario === 'removed-identity' ? 'ok' : 'conflict', scenario);
    if (scenario === 'removed-identity')
      assert.equal(
        f.db.raw.prepare("SELECT 1 FROM identities WHERE external_id='old-discord'").get(),
        undefined,
      );
    else
      assert.equal(
        f.db.raw.prepare('SELECT unmerged_at FROM merges WHERE id=?').get(combined.value.mergeId)
          ?.unmerged_at,
        null,
      );
  }
});

void test('merge and undo roll back the complete operation on a history write failure', async () => {
  const f = await mergeFixture();
  f.db.raw.exec(
    "CREATE TRIGGER fail_merge BEFORE INSERT ON staff_audits WHEN NEW.action='person.merge' BEGIN SELECT RAISE(ABORT,'fixture_failure'); END",
  );
  await assert.rejects(f.mergePeople(f.db, f.actor, f.input), /fixture_failure/);
  assert.ok(await f.people.getPerson(f.merged.id));
  assert.equal((await f.people.getPerson(f.survivor.id))?.phone, null);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM merges').get()?.n, 0);
  f.db.raw.exec('DROP TRIGGER fail_merge');
  const combined = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(combined.kind, 'ok');
  f.db.raw.exec(
    "CREATE TRIGGER fail_undo BEFORE INSERT ON staff_audits WHEN NEW.action='person.unmerge' BEGIN SELECT RAISE(ABORT,'fixture_failure'); END",
  );
  await assert.rejects(
    f.undoMerge(f.db, f.actor, {
      mergeId: combined.value.mergeId,
      reason: 'Wrong match',
      operationId: 'undo-fail',
    }),
    /fixture_failure/,
  );
  assert.equal(await f.people.getPerson(f.merged.id), null);
  assert.equal((await f.people.getPerson(f.survivor.id))?.phone, '+17025550100');
});

void test('undo releases a copied email before restoring its original owner', async () => {
  const f = await mergeFixture();
  await f.people.updateFields(f.survivor.id, {
    source: 'staff',
    fields: { email: null },
    allowClear: true,
  });
  await f.people.updateFields(f.merged.id, {
    source: 'staff',
    fields: { email: 'moved@example.invalid' },
  });
  const combined = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(combined.kind, 'ok');
  assert.equal((await f.people.getPerson(f.survivor.id))?.email, 'moved@example.invalid');
  assert.equal(
    (
      await f.undoMerge(f.db, f.actor, {
        mergeId: combined.value.mergeId,
        reason: 'Different people',
        operationId: 'undo-email',
      })
    ).kind,
    'ok',
  );
  assert.equal((await f.people.getPerson(f.survivor.id))?.email, null);
  assert.equal((await f.people.getPerson(f.merged.id))?.email, 'moved@example.invalid');
});

void test('undo restores all original row owners, carries later assignment changes, and restores automatic suppression only when no later withdrawal exists', async () => {
  const f = await mergeFixture();
  const assigned = await f.committees.assign({
    personId: f.merged.id,
    committeeId: 'events',
    role: 'member',
    actorId: f.actor.personId,
    operationId: 'original-assignment',
  });
  assert.equal(assigned.kind, 'ok');
  await correctPerson(f.db, f.actor, f.merged.id, {
    fields: { family_name: 'Original correction' },
    reason: 'Confirmed',
    operationId: 'original-correction',
  });
  f.db.raw
    .prepare('INSERT INTO form_submissions VALUES (?,?,?,?)')
    .run('original-form', f.merged.id, '2026-01-01', '2026-01-01');
  f.db.raw
    .prepare('INSERT INTO workspace_link_operations VALUES (?,?,?,?)')
    .run('original-link', f.merged.id, 'original-subject', '2026-01-01');
  await f.people.withdrawConsent(f.survivor.id, {
    scope: 'newsletter',
    source: 'beehiiv',
    withdrawnAt: '2090-01-01T00:00:00Z',
  });
  const originals = new Map(
    [
      'consent_records',
      'engagement_events',
      'committee_assignments',
      'person_corrections',
      'form_submissions',
      'workspace_link_operations',
    ].map((table) => [
      table,
      f.db.raw.prepare(`SELECT * FROM ${table} WHERE person_id=?`).all(f.merged.id),
    ]),
  );
  const combined = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(combined.kind, 'ok');
  await f.committees.endAssignment(
    assigned.value.id,
    'stepped_back',
    f.actor.personId,
    'later-end',
  );
  const undone = await f.undoMerge(f.db, f.actor, {
    mergeId: combined.value.mergeId,
    reason: 'Different people',
    operationId: 'restore-all',
  });
  assert.equal(undone.kind, 'ok');
  for (const [table, rows] of originals) {
    const key =
      table === 'form_submissions'
        ? 'form_token'
        : table === 'workspace_link_operations'
          ? 'operation_id'
          : 'id';
    for (const row of rows)
      assert.equal(
        f.db.raw.prepare(`SELECT person_id FROM ${table} WHERE ${key}=?`).get(String(row[key]))
          ?.person_id,
        f.merged.id,
      );
  }
  assert.equal(
    f.db.raw
      .prepare('SELECT end_reason FROM committee_assignments WHERE id=?')
      .get(assigned.value.id)?.end_reason,
    'stepped_back',
  );
  assert.equal((await f.people.getPerson(f.merged.id))?.membership_status, 'member');
  assert.equal((await f.people.getPerson(f.survivor.id))?.membership_status, 'former_member');
});

void test('undo rechecks current permission and later changes inside the transaction', async () => {
  const f = await mergeFixture();
  const combined = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(combined.kind, 'ok');
  assert.equal(
    (
      await f.undoMerge(
        f.db,
        { ...f.actor, personId: f.survivor.id },
        { mergeId: combined.value.mergeId, reason: 'Confirmed', operationId: 'forged-undo' },
      )
    ).kind,
    'forbidden',
  );
  assert.equal(
    (
      await f.undoMerge(f.db, f.actor, {
        mergeId: combined.value.mergeId,
        reason: '',
        operationId: 'empty-reason',
      })
    ).kind,
    'invalid',
  );
  const raced: Db = {
    prepare: (sql) => f.db.prepare(sql),
    batch: async (statements) => {
      await f.people.recordEngagement(f.survivor.id, {
        type: 'welcomed',
        source: 'staff',
        occurredAt: '2090-01-01T00:00:00Z',
        reference: 'undo-race',
      });
      return f.db.batch(statements);
    },
  };
  assert.equal(
    (
      await f.undoMerge(raced, f.actor, {
        mergeId: combined.value.mergeId,
        reason: 'Confirmed',
        operationId: 'raced-undo',
      })
    ).kind,
    'conflict',
  );
  assert.equal(await f.people.getPerson(f.merged.id), null);
});
