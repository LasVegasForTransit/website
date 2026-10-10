import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFixture } from './support/merge-fixture';
import { staffAdminManage, loadActor } from '../src/staff-roles';
import { linkWorkspaceIdentity } from '../src/workspace-link';
void test('undo rejects a replaced external account rather than transferring the new account', async () => {
  const f = await mergeFixture();
  await f.people.linkIdentity(f.merged.id, {
    platform: 'discord',
    externalId: 'old-discord',
    linkMethod: 'staff_confirmed',
  });
  const combined = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(combined.kind, 'ok');
  f.db.raw
    .prepare(
      "UPDATE identities SET external_id='replacement-discord' WHERE external_id='old-discord'",
    )
    .run();
  assert.equal(
    (
      await f.undoMerge(f.db, f.actor, {
        mergeId: combined.value.mergeId,
        reason: 'Different people',
        operationId: 'undo-replaced',
      })
    ).kind,
    'conflict',
  );
  assert.equal(
    f.db.raw
      .prepare("SELECT person_id FROM identities WHERE external_id='replacement-discord'")
      .get()?.person_id,
    f.survivor.id,
  );
});
void test('identical withdrawals on two entries retain separate evidence when combined and undone', async () => {
  const f = await mergeFixture();
  for (const id of [f.survivor.id, f.merged.id])
    await f.people.withdrawConsent(id, {
      scope: 'newsletter',
      source: 'beehiiv',
      withdrawnAt: '2090-01-01T00:00:00Z',
    });
  const combined = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(combined.kind, 'ok');
  assert.equal(
    f.db.raw
      .prepare('SELECT count(*) AS n FROM consent_withdrawals WHERE person_id=?')
      .get(f.survivor.id)?.n,
    2,
  );
  assert.equal(
    (
      await f.undoMerge(f.db, f.actor, {
        mergeId: combined.value.mergeId,
        reason: 'Different people',
        operationId: 'undo-withdrawals',
      })
    ).kind,
    'ok',
  );
  for (const id of [f.survivor.id, f.merged.id])
    assert.equal((await f.people.getPerson(id))?.membership_status, 'former_member');
});
void test('administrator access follows the combined Workspace account and returns to the original person on undo', async () => {
  const f = await mergeFixture();
  await linkWorkspaceIdentity(f.db, {
    personId: f.merged.id,
    workspace: {
      subject: 'second-admin',
      email: 'second@lasvegasfortransit.org',
      givenName: null,
      familyName: null,
    },
    method: 'staff_confirmed',
    operationId: 'second-link',
  });
  assert.equal(
    (
      await staffAdminManage(f.db, f.actor, {
        targetPersonId: f.merged.id,
        enabled: true,
        operationId: 'second-admin',
      })
    ).kind,
    'ok',
  );
  const combined = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(combined.kind, 'ok');
  assert.equal((await loadActor(f.db, f.survivor.id))?.staffAdmin, true);
  assert.equal((await loadActor(f.db, f.survivor.id))?.workspaceLinked, true);
  assert.equal(await loadActor(f.db, f.merged.id), null);
  assert.equal(
    (
      await f.undoMerge(f.db, f.actor, {
        mergeId: combined.value.mergeId,
        reason: 'Different people',
        operationId: 'undo-admin',
      })
    ).kind,
    'ok',
  );
  assert.equal((await loadActor(f.db, f.merged.id))?.staffAdmin, true);
  assert.equal((await loadActor(f.db, f.survivor.id))?.staffAdmin, false);
  assert.equal((await loadActor(f.db, f.survivor.id))?.workspaceLinked, false);
});
void test('a resolved or mismatched review cannot authorize a combination', async () => {
  const f = await mergeFixture();
  const stamp = new Date().toISOString();
  f.db.raw
    .prepare(
      'INSERT INTO review_queue(id,candidate_person_id,existing_person_id,reason,created_at,updated_at) VALUES (?,?,?,?,?,?)',
    )
    .run('wrong-pair', f.survivor.id, f.survivor.id, 'fixture', stamp, stamp);
  assert.equal(
    (await f.mergePeople(f.db, f.actor, { ...f.input, reviewId: 'wrong-pair' })).kind,
    'conflict',
  );
});
void test('merge bookkeeping cannot be rewritten after the operation completes', async () => {
  const f = await mergeFixture();
  const combined = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(combined.kind, 'ok');
  assert.throws(
    () =>
      f.db.raw.prepare("UPDATE merges SET moved_rows='{}' WHERE id=?").run(combined.value.mergeId),
    /cannot be changed/,
  );
});
