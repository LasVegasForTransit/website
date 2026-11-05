import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  googleOverviewFixture,
  consoleGroupEmail,
  groupEmail,
  now,
} from './support/google-group-overview-fixture';
import { enrollWorkspaceAccount } from '../src/workspace-enrollment';
import { listGoogleGroupOverview } from '../src/google-group-overview';
const policy = {
  environment: 'production' as const,
  customerId: 'Cpreview',
  humanOrgUnitIds: ['ou-human'],
  includedUserIds: [],
  excludedUserIds: [],
  previewUserIds: [],
};
const human = {
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
};
void test('Console inventory expects all active human enrollees and recognizes their provisioned identity', async () => {
  const f = await googleOverviewFixture();
  try {
    await enrollWorkspaceAccount(f.db, human, policy, now);
    await f.save({
      ...f.snapshot,
      groupEmail: consoleGroupEmail,
      groupId: 'console-fixture',
      members: [{ id: human.userId, type: 'USER', role: 'MEMBER' }],
    });
    let overview = await listGoogleGroupOverview(f.db, f.actor, f.query);
    assert.ok(overview.console);
    assert.equal(overview.console.expectedCount, 1);
    assert.equal(overview.console.missingCount, 0);
    assert.equal(overview.console.unconfirmedCount, 0);
    assert.equal(overview.console.unexpectedCount, 0);
    assert.equal(overview.console.unmatchedCount, 0);
    const later = new Date(now.getTime() + 1000);
    await enrollWorkspaceAccount(
      f.db,
      { ...human, suspended: true, observedAt: later.toISOString() },
      policy,
      later,
    );
    overview = await listGoogleGroupOverview(f.db, f.actor, { ...f.query, now: later });
    assert.ok(overview.console);
    assert.equal(overview.console.expectedCount, 0);
    assert.equal(overview.console.unexpectedCount, 1);
  } finally {
    f.db.raw.close();
  }
});
void test('committee inventory preserves assignments but does not expect Google access from suspended enrollees', async () => {
  const f = await googleOverviewFixture();
  try {
    await enrollWorkspaceAccount(
      f.db,
      {
        ...human,
        userId: 'expected-user',
        email: 'expected-user@lasvegasfortransit.org',
        suspended: true,
      },
      policy,
      now,
    );
    const overview = await listGoogleGroupOverview(f.db, f.actor, f.query);
    assert.equal(overview.items.find((g) => g.groupEmail === groupEmail)?.expectedCount, 1);
  } finally {
    f.db.raw.close();
  }
});
