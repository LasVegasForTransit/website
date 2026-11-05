import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkspaceConnectorPolicy } from '@lasvegasfortransit/platform-core/workspace-connector';
import { memoryDb } from './support/db';
import { enrollWorkspaceAccount } from '../src/workspace-enrollment';
import {
  claimWorkspaceGroup,
  workspaceGroupCurrent,
  prepareWorkspaceGroup,
  observeWorkspaceGroup,
  finishWorkspaceGroup,
} from '../src/workspace-connector';

const now = new Date('2026-11-04T20:00:00Z');
const policy: WorkspaceConnectorPolicy = {
  environment: 'preview',
  customerId: 'C-lvbt',
  humanOrgUnitIds: ['people'],
  includedUserIds: [],
  excludedUserIds: [],
  previewUserIds: ['allowed'],
  consoleGroupEmail: 'console-preview@lasvegasfortransit.org',
  productionConsoleGroupEmail: 'console-users@lasvegasfortransit.org',
  managedGroups: ['committee-preview@lasvegasfortransit.org'],
  productionGroups: ['committee@lasvegasfortransit.org'],
};
async function enroll(db: ReturnType<typeof memoryDb>, userId: string) {
  const result = await enrollWorkspaceAccount(
    db,
    {
      customerId: policy.customerId,
      userId,
      email: `${userId}@lasvegasfortransit.org`,
      givenName: 'Test',
      familyName: 'Person',
      orgUnitId: 'people',
      suspended: false,
      archived: false,
      deleted: false,
      observedAt: now.toISOString(),
    },
    { ...policy, environment: 'production' },
    now,
  );
  assert.ok(result.personId);
  return result.personId;
}
function committee(db: ReturnType<typeof memoryDb>, person: string) {
  db.raw.prepare("UPDATE people SET membership_status='member' WHERE id=?").run(person);
  db.raw
    .prepare("UPDATE committees SET workspace_group_email=? WHERE id='events'")
    .run('committee-preview@lasvegasfortransit.org');
  db.raw
    .prepare(
      "INSERT INTO committee_assignments(id,person_id,committee_id,role,started_at,assigned_by,updated_at) VALUES(?,?,'events','member',?,?,?)",
    )
    .run(`assignment-${person}`, person, now.toISOString(), person, now.toISOString());
}
for (const kind of ['console', 'committee'] as const) {
  void test(`preview ${kind} skips out-of-scope queued users without starving an allowed user`, async () => {
    const db = memoryDb();
    try {
      for (let i = 0; i < 12; i++) {
        const person = await enroll(db, `excluded-${i}`);
        if (kind === 'committee') committee(db, person);
      }
      const person = await enroll(db, 'allowed');
      if (kind === 'committee') {
        committee(db, person);
        db.raw.prepare("UPDATE workspace_directory_accounts SET console_due_at='2099-01-01'").run();
        // A preexisting verified identity need not have passed Directory enrollment.
        db.raw.prepare("UPDATE identities SET link_method='staff_confirmed'").run();
        db.raw.prepare('DELETE FROM workspace_directory_accounts').run();
      } else {
        db.raw
          .prepare(
            "UPDATE workspace_directory_accounts SET console_due_at='2026-11-03' WHERE user_id<>'allowed'",
          )
          .run();
      }
      const claim = await claimWorkspaceGroup(db, policy, now);
      assert.ok(claim);
      assert.equal(claim.plan.kind, kind);
      assert.equal(claim.plan.userId, 'allowed');
      assert.equal(await workspaceGroupCurrent(db, claim.token, policy, now), true);
    } finally {
      db.raw.close();
    }
  });
  void test(`preview ${kind} rejects every stage of an issued claim after its user leaves the allowlist`, async () => {
    const db = memoryDb();
    try {
      const person = await enroll(db, 'allowed');
      if (kind === 'committee') {
        committee(db, person);
        db.raw.prepare("UPDATE workspace_directory_accounts SET console_due_at='2099-01-01'").run();
      }
      const claim = await claimWorkspaceGroup(db, policy, now);
      assert.ok(claim);
      assert.equal(claim.plan.kind, kind);
      const group = claim.plan.groups[0];
      assert.ok(group);
      const resourceId = group.resourceId;
      const observation = {
        identityId: claim.plan.userId,
        identityEmail: claim.plan.email,
        groupEmail: resourceId,
        groupId: 'group',
        direct: true,
        granted: true,
        role: 'MEMBER',
      };
      assert.equal(
        await prepareWorkspaceGroup(
          db,
          { token: claim.token, resourceId, wasGranted: false },
          policy,
          now,
        ),
        true,
      );
      assert.equal(
        await observeWorkspaceGroup(db, { token: claim.token, observed: observation }, policy, now),
        true,
      );
      const narrowed = { ...policy, previewUserIds: ['someone-else'] };
      assert.equal(await workspaceGroupCurrent(db, claim.token, narrowed, now), false);
      assert.equal(
        await prepareWorkspaceGroup(
          db,
          { token: claim.token, resourceId, wasGranted: true },
          narrowed,
          now,
        ),
        false,
      );
      assert.equal(
        await observeWorkspaceGroup(
          db,
          { token: claim.token, observed: observation },
          narrowed,
          now,
        ),
        false,
      );
      assert.equal(await finishWorkspaceGroup(db, { token: claim.token }, narrowed, now), false);
      assert.equal(
        await finishWorkspaceGroup(
          db,
          {
            token: claim.token,
            failure: { kind: 'provider_unavailable', retryAfterMs: 1000, resourceId },
          },
          narrowed,
          now,
        ),
        false,
      );
      assert.equal(await finishWorkspaceGroup(db, { token: claim.token }, policy, now), true);
    } finally {
      db.raw.close();
    }
  });
}
