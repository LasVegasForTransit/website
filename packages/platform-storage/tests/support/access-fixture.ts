import assert from 'node:assert/strict';
import { mergeFixture } from './merge-fixture';
export async function accessFixture() {
  const view = await import('../../src/access-view').catch(() => null);
  const observations = await import('../../src/access-observations').catch(() => null);
  const recovery = await import('../../src/access-recovery').catch(() => null);
  assert.ok(view, 'staff must distinguish saved assignments from observed provider access');
  assert.ok(observations, 'provider confirmations must be bounded and tied to current accounts');
  assert.ok(recovery, 'access recovery must reject removed and superseded grants');
  const f = await mergeFixture();
  await f.people.linkIdentity(f.survivor.id, {
    platform: 'discord',
    externalId: '123',
    linkMethod: 'self_linked',
  });
  f.db.raw.prepare("UPDATE committees SET discord_role_id='456' WHERE id='events'").run();
  const assigned = await f.committees.assign({
    personId: f.survivor.id,
    committeeId: 'events',
    role: 'member',
    actorId: f.admin.id,
    operationId: 'grant',
  });
  assert.equal(assigned.kind, 'ok');
  const configuration = { discord: { configured: true, contextId: 'guild', memberRoleId: '789' } };
  const stamp = new Date();
  const observation = {
    personId: f.survivor.id,
    targetId: 'events',
    provider: 'discord' as const,
    identityId: '123',
    identityEmail: null,
    resourceId: '456',
    contextId: 'guild',
    generation: 1,
    expectedAccess: true,
    state: 'granted' as const,
    observedAt: stamp.toISOString(),
    expiresAt: new Date(stamp.getTime() + 300_000).toISOString(),
  };
  return {
    ...f,
    ...view,
    ...observations,
    ...recovery,
    assigned: assigned.value,
    configuration,
    observation,
  };
}
