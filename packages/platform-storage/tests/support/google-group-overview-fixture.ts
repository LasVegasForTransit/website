import assert from 'node:assert/strict';
import { mergeFixture } from './merge-fixture';
import { linkWorkspaceIdentity } from '../../src/workspace-link';
import { saveGoogleGroupSnapshot } from '../../src/google-group-snapshots';

export const groupEmail = 'preview-events@lasvegasfortransit.org';
export const consoleGroupEmail = 'console-users@lasvegasfortransit.org';
export const now = new Date('2026-10-14T12:00:05.000Z');
export async function googleOverviewFixture() {
  const f = await mergeFixture();
  const link = async (personId: string, subject: string) => {
    const result = await linkWorkspaceIdentity(f.db, {
      workspace: {
        subject,
        email: `${subject}@lasvegasfortransit.org`,
        givenName: null,
        familyName: null,
      },
      personId,
      method: 'self_linked',
      operationId: `link-${subject}`,
    });
    assert.equal(result.kind, 'ok');
  };
  await link(f.survivor.id, 'expected-user');
  await f.committees.assign({
    personId: f.survivor.id,
    committeeId: 'events',
    role: 'member',
    actorId: f.admin.id,
    operationId: 'expect-events',
  });
  const extra = await f.create('extra@example.invalid', 'Extra Member');
  await link(extra.id, 'extra-user');
  const unconfirmed = await f.create('unconfirmed@example.invalid', 'Account to confirm');
  await f.committees.assign({
    personId: unconfirmed.id,
    committeeId: 'events',
    role: 'member',
    actorId: f.admin.id,
    operationId: 'unconfirmed-events',
  });
  f.db.raw
    .prepare('UPDATE committees SET workspace_group_email=? WHERE id=?')
    .run(groupEmail, 'events');
  const snapshot = {
    customerId: 'Cpreview',
    groupEmail,
    groupId: 'google-events',
    startedAt: '2026-10-14T12:00:00.000Z',
    observedAt: '2026-10-14T12:00:01.000Z',
    members: [
      { id: 'extra-user', type: 'USER', role: 'MEMBER' },
      { id: 'unmatched-user', type: 'USER', role: 'OWNER' },
      { id: 'nested-group', type: 'GROUP', role: 'MEMBER' },
    ],
  };
  const save = (value = snapshot) =>
    saveGoogleGroupSnapshot(f.db, value, {
      consoleGroupEmail,
      now,
      isCurrent: () => Promise.resolve(true),
    });
  assert.equal(await save(), true);
  const configuration = {
    configured: true,
    contextId: 'Cpreview',
    resourceIds: [groupEmail, consoleGroupEmail],
  };
  return {
    ...f,
    extra,
    unconfirmed,
    link,
    snapshot,
    save,
    configuration,
    query: { configuration, consoleGroupEmail, now, problemsOnly: false },
  };
}
