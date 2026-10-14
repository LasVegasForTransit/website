import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './support/google-sync-fixture';
import { configuration, groupEmail, userId } from './support/google-directory';
void test('inherited access remains an actionable staff review through reconciliation and clears after Google resolves it', async () => {
  const f = await fixture();
  const { bootstrapStaffAdmin, loadActor } =
    await import('@lasvegasfortransit/platform-storage/staff-roles');
  const { saveGoogleGroupSnapshot } =
    await import('@lasvegasfortransit/platform-storage/google-group-snapshots');
  const { getGoogleGroupReview } =
    await import('@lasvegasfortransit/platform-storage/google-group-overview');
  const { requestGoogleGroupAccessUpdate } =
    await import('@lasvegasfortransit/platform-storage/google-group-actions');
  const now = new Date();
  await bootstrapStaffAdmin(f.db, {
    presidentPersonId: f.person.id,
    workspaceSubject: userId,
    performedBy: 'fixture',
    operationId: 'inherited-admin',
  });
  const actor = await loadActor(f.db, f.person.id);
  assert.ok(actor);
  await f.db
    .prepare("UPDATE committee_assignments SET ended_at=?,end_reason='removed' WHERE person_id=?")
    .bind(now.toISOString(), f.person.id)
    .run();
  assert.equal(
    await saveGoogleGroupSnapshot(
      f.db,
      {
        customerId: configuration.customerId,
        groupEmail,
        groupId: 'group-advocacy',
        startedAt: now.toISOString(),
        observedAt: now.toISOString(),
        members: [{ id: userId, type: 'USER', role: 'MEMBER' }],
      },
      { consoleGroupEmail: null, now, isCurrent: () => Promise.resolve(true) },
    ),
    true,
  );
  const query = {
    groupEmail,
    configuration: {
      configured: true,
      contextId: configuration.customerId,
      resourceIds: [groupEmail],
    },
    consoleGroupEmail: null,
    now,
  };
  const before = await getGoogleGroupReview(f.db, actor, query);
  assert.ok(before);
  const input = {
    ...query,
    personId: f.person.id,
    identityId: userId,
    expectedSnapshot: JSON.stringify([
      before.summary.groupId,
      before.summary.contentHash,
      before.summary.startedAt,
    ]),
    expectedAccess: false,
    operationId: 'inherited-review',
  };
  assert.equal((await requestGoogleGroupAccessUpdate(f.db, actor, input, now)).kind, 'ok');
  f.remote.state.inherited = true;
  assert.equal(
    (await f.syncGoogleOperation(f.db, input.operationId, { client: f.client })).kind,
    'retry',
  );
  const review = await getGoogleGroupReview(f.db, actor, query);
  assert.equal(review?.items[0]?.requestReviewReason, 'inherited_access');
  assert.equal(
    f.remote.calls.some((call) => call.method !== 'GET'),
    false,
    'ancestor group access must not trigger a broader write',
  );
  f.remote.state.inherited = false;
  await f.db
    .prepare("UPDATE integration_outbox SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE id=?")
    .bind(input.operationId)
    .run();
  assert.equal(
    (await f.syncGoogleOperation(f.db, input.operationId, { client: f.client })).kind,
    'confirmed',
  );
  const resolved = await getGoogleGroupReview(f.db, actor, query);
  assert.equal(resolved?.items[0]?.requestReviewReason, null);
});
