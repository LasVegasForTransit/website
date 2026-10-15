import assert from 'node:assert/strict';
import { googleOverviewFixture, now } from './google-group-overview-fixture';
import { recordAccessObservation } from '../../src/access-observations';
export const guild = '111111111111111111',
  role = '222222222222222222';
export async function fixture() {
  const api = await import('../../src/committee-access').catch(() => null);
  assert.ok(
    api,
    'staff need combined committee holder and mismatch counts from stored provider checks',
  );
  const f = await googleOverviewFixture();
  f.db.raw.prepare("UPDATE committees SET discord_role_id=? WHERE id='events'").run(role);
  await f.people.linkIdentity(f.survivor.id, {
    platform: 'discord',
    externalId: '333333333333333333',
    linkMethod: 'self_linked',
  });
  await f.people.linkIdentity(f.extra.id, {
    platform: 'discord',
    externalId: '444444444444444444',
    linkMethod: 'self_linked',
  });
  for (const [personId, identityId, generation, expectedAccess, state] of [
    [f.survivor.id, '333333333333333333', 1, true, 'absent'],
    [f.extra.id, '444444444444444444', 0, false, 'granted'],
  ] as const)
    assert.equal(
      await recordAccessObservation(
        f.db,
        {
          personId,
          targetId: 'events',
          provider: 'discord',
          identityId,
          identityEmail: null,
          resourceId: role,
          contextId: guild,
          generation,
          expectedAccess,
          state,
          observedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 300000).toISOString(),
        },
        now,
      ),
      true,
    );
  const configuration = {
    google_workspace: f.configuration,
    discord: { configured: true, contextId: guild, memberRoleId: '555555555555555555' },
  };
  return { ...f, ...api, configuration };
}
