import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessFixture } from './support/access-fixture';
import { enrollWorkspaceAccount, workspaceEnrollment } from '../src/workspace-enrollment';
import { workspaceStatus, retryWorkspaceConsole } from '../src/workspace-status';
void test('readiness distinguishes a queued check from fresh readback and only an administrator can retry', async () => {
  const f = await accessFixture();
  try {
    const now = new Date(),
      policy = {
        environment: 'production' as const,
        customerId: 'C-lvbt',
        humanOrgUnitIds: ['ou-human'],
        includedUserIds: [],
        excludedUserIds: [],
        previewUserIds: [],
      };
    const enrolled = await enrollWorkspaceAccount(
      f.db,
      {
        customerId: policy.customerId,
        userId: 'new-human',
        email: 'new-human@lasvegasfortransit.org',
        givenName: 'New',
        familyName: 'Human',
        orgUnitId: 'ou-human',
        suspended: false,
        archived: false,
        deleted: false,
        observedAt: now.toISOString(),
      },
      policy,
      now,
    );
    assert.ok(enrolled.personId);
    const e = await workspaceEnrollment(f.db, enrolled.personId);
    assert.ok(e);
    assert.equal(workspaceStatus(e, now).admission, 'Portal group access awaiting confirmation');
    assert.equal(
      workspaceStatus(
        { ...e, console_state: 'granted', console_checked_at: now.toISOString() },
        now,
      ).admission,
      'Portal group access confirmed',
    );
    assert.equal(
      workspaceStatus(
        {
          ...e,
          console_state: 'granted',
          console_checked_at: new Date(now.getTime() - 3600001).toISOString(),
        },
        now,
      ).admission,
      'Portal group access last confirmed',
    );
    f.db.raw
      .prepare("UPDATE workspace_directory_accounts SET console_failure='permission_denied'")
      .run();
    assert.equal(
      await retryWorkspaceConsole(
        f.db,
        { ...f.actor, personId: f.survivor.id },
        enrolled.personId,
        now,
      ),
      false,
    );
    assert.equal(await retryWorkspaceConsole(f.db, f.actor, enrolled.personId, now), true);
    const after = await workspaceEnrollment(f.db, enrolled.personId);
    assert.ok(after);
    assert.equal(after.console_checked_at, null);
    assert.equal(after.console_failure, null);
    assert.equal(
      f.db.raw.prepare('SELECT console_due_at FROM workspace_directory_accounts').get()
        ?.console_due_at,
      now.toISOString(),
    );
  } finally {
    f.db.raw.close();
  }
});
