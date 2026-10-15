import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFixture } from './support/merge-fixture';
import { runMaintenance } from '../src/retention';
import { PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';

void test('Workspace erasure flags review once, preserves account identifiers and survives profile purge', async () => {
  const f = await mergeFixture();
  try {
    await f.people.linkIdentity(f.survivor.id, {
      platform: 'google_workspace',
      externalId: 'workspace-subject',
      externalEmail: 'private@example.invalid',
      linkMethod: 'self_linked',
    });
    await f.people.deletePerson(f.survivor.id);
    assert.equal(
      f.db.raw
        .prepare('SELECT count(*) AS n FROM consent_records WHERE person_id=?')
        .get(f.survivor.id)?.n,
      0,
      'local consent evidence must be erased immediately',
    );
    const flag = f.db.raw.prepare('SELECT * FROM workspace_offboarding_queue').get();
    assert.ok(flag);
    assert.equal(flag.person_id, f.survivor.id);
    assert.equal(flag.reason, 'erased');
    assert.equal(flag.reviewed_at, null);
    await f.people.deletePerson(f.survivor.id);
    assert.deepEqual(f.db.raw.prepare('SELECT * FROM workspace_offboarding_queue').get(), flag);
    await runMaintenance(f.db, { now: new Date('2030-01-01T00:00:00Z'), category: 'profiles' });
    assert.equal(
      f.db.raw.prepare('SELECT external_id FROM identities WHERE person_id=?').get(f.survivor.id)
        ?.external_id,
      'workspace-subject',
    );
    assert.equal(
      f.db.raw.prepare('SELECT external_email FROM identities WHERE person_id=?').get(f.survivor.id)
        ?.external_email,
      null,
    );
    assert.deepEqual(f.db.raw.prepare('SELECT * FROM workspace_offboarding_queue').get(), flag);
    assert.equal(JSON.stringify(flag).includes('@'), false);
    assert.deepEqual(f.db.raw.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    f.db.raw.close();
  }
});
void test('only a current administrator may review a Workspace flag, with replay and stale-flag safety', async () => {
  const api = await import('../src/workspace-offboarding').catch(() => null);
  assert.ok(api, 'staff need a protected queue and review action for Workspace offboarding');
  const f = await mergeFixture();
  try {
    await f.people.linkIdentity(f.survivor.id, {
      platform: 'google_workspace',
      externalId: 'workspace-subject',
      linkMethod: 'self_linked',
    });
    await f.people.withdrawConsent(f.survivor.id, {
      scope: 'newsletter',
      source: 'account',
      withdrawnAt: new Date().toISOString(),
    });
    const page = await api.workspaceOffboardingQueue(f.db, f.actor);
    assert.equal(page.items.length, 1);
    const item = page.items[0];
    assert.ok(item);
    const input = {
      identityRecordId: item.identityRecordId,
      expectedRevision: item.revision,
      operationId: 'review-one',
    };
    assert.equal(
      (await api.reviewWorkspaceOffboarding(f.db, { ...f.actor, personId: f.merged.id }, input))
        .kind,
      'forbidden',
    );
    assert.equal((await api.reviewWorkspaceOffboarding(f.db, f.actor, input)).kind, 'ok');
    assert.equal((await api.reviewWorkspaceOffboarding(f.db, f.actor, input)).kind, 'ok');
    assert.equal((await api.workspaceOffboardingQueue(f.db, f.actor)).items.length, 0);
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT count(*) AS n FROM staff_audits WHERE action='workspace.offboarding_reviewed'",
        )
        .get()?.n,
      1,
    );
    await f.people.deletePerson(f.survivor.id);
    assert.equal((await api.workspaceOffboardingQueue(f.db, f.actor)).items.length, 1);
    assert.equal(
      (await api.reviewWorkspaceOffboarding(f.db, f.actor, { ...input, operationId: 'stale' }))
        .kind,
      'conflict',
    );
    assert.equal((await api.reviewWorkspaceOffboarding(f.db, f.actor, input)).kind, 'ok');
    assert.equal(
      (await api.workspaceOffboardingQueue(f.db, f.actor)).items.length,
      1,
      'a replay cannot dismiss a later flag',
    );
    f.db.raw
      .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
      .run(f.admin.id);
    await assert.rejects(api.workspaceOffboardingQueue(f.db, f.actor), PermissionDenied);
    assert.equal((await api.reviewWorkspaceOffboarding(f.db, f.actor, input)).kind, 'forbidden');
  } finally {
    f.db.raw.close();
  }
});
