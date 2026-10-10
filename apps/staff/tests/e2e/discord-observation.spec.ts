import assert from 'node:assert/strict';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { enqueueOperation } from '@lasvegasfortransit/platform-storage/outbox';
import { reconcileDiscordPending } from '@lasvegasfortransit/platform-integrations/discord-runner';
import { ORIGIN, startRuntime } from '../support/runtime';
import { exerciseProviderHistory } from './support/provider-history';

const fixture = await startRuntime({ discord: true });
const userId = '222222222222222222';
const guildId = '111111111111111111';
const memberRoleId = '333333333333333333';
const applicationId = '555555555555555555';
const roles = new Set(['777777777777777777']);
let unreachable = false;
const people = new PersonService(fixture.db);
const personId = fixture.welcomePerson.id;
const welcomeEmail = fixture.welcomePerson.email;
assert.ok(welcomeEmail);
const welcomeSearch = `/people/?q=${encodeURIComponent(welcomeEmail)}`;
const fetcher: typeof fetch = (input, init) => {
  assert.ok(typeof input === 'string');
  assert.equal(
    input.startsWith(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`),
    true,
  );
  if (unreachable) return new Promise<Response>(() => undefined);
  if (init?.method === 'PUT') roles.add(memberRoleId);
  if (init?.method === 'DELETE') roles.delete(memberRoleId);
  return Promise.resolve(
    init?.method === 'PUT' || init?.method === 'DELETE'
      ? new Response(null, { status: 204 })
      : Response.json({
          user: { id: userId, username: 'fixture', avatar: null },
          roles: [...roles],
          pending: false,
          nick: null,
        }),
  );
};
const options = {
  applicationId,
  memberRoleId,
  configuration: {
    environment: 'preview' as const,
    guildId,
    productionGuildId: '999999999999999999',
    botToken: 'fixture-only',
  },
  fetch: fetcher,
};
async function profile(path = `/people/${personId}/`) {
  const response = await fixture.simulator.dispatchFetch(`${ORIGIN}${path}`, {
    headers: {
      'Cf-Access-Jwt-Assertion': fixture.admin.assertion,
      Cookie: `__Host-lvbt_session=${fixture.admin.session.token}`,
    },
  });
  assert.equal(response.status, 200);
  return await response.text();
}
try {
  const unlinkedRoster = await profile(
    `/people/?q=${encodeURIComponent('rider00001@example.invalid')}`,
  );
  assert.equal(
    unlinkedRoster.includes('Discord: not linked'),
    true,
    'an all-unlinked result page should keep Discord status visible when the provider is configured',
  );
  await people.linkIdentity(personId, {
    platform: 'discord',
    externalId: userId,
    linkMethod: 'self_linked',
  });
  await fixture.db
    .prepare(
      "INSERT INTO reconcile_generations(person_id,target_id,generation) VALUES(?,'person',1)",
    )
    .bind(personId)
    .run();
  await enqueueOperation(fixture.db, {
    id: 'observation-fixture',
    kind: 'person_reconcile',
    personId,
    targetId: 'person',
    generation: 1,
    payload: {},
  });
  assert.equal((await profile()).includes('Member role confirmed'), false);
  assert.equal((await reconcileDiscordPending(fixture.db, options)).confirmed, 1);
  const confirmedProfile = await profile();
  assert.equal(confirmedProfile.includes('Member role confirmed'), true);
  assert.equal(confirmedProfile.includes('In LVBT Discord'), true);
  assert.equal((await profile(welcomeSearch)).includes('Discord: in server'), true);
  assert.equal(
    confirmedProfile.includes('Discord access granted'),
    true,
    'administrators need the confirmed access history on the member profile',
  );
  const granted = await profile(`/access/?person=${personId}`);
  assert.equal(granted.includes('Discord access granted'), true);
  assert.equal(granted.includes('Automatic Discord update'), true);
  await people.withdrawConsent(personId, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: new Date().toISOString(),
  });
  const changed = await profile();
  assert.equal(changed.includes('Former member'), true);
  assert.equal(
    changed.includes('Member role confirmed'),
    false,
    'an old grant cannot prove access after withdrawal',
  );
  assert.equal((await reconcileDiscordPending(fixture.db, options)).confirmed, 1);
  assert.equal((await profile()).includes('Member role removed'), true);
  const removed = await profile(`/access/?person=${personId}`);
  assert.equal(removed.includes('Discord access removed'), true);
  assert.equal(removed.includes('Membership changed'), true);
  assert.equal(
    removed.includes('Waiting to remove account access.'),
    false,
    'a confirmed Discord removal must not be described as still waiting',
  );
  assert.equal(removed.includes('Other account updates are still pending.'), true);
  assert.deepEqual([...roles], ['777777777777777777']);
  const observedAt = new Date().toISOString();
  await fixture.db
    .prepare('UPDATE discord_profiles SET in_guild=0,observed_at=?,expires_at=? WHERE guild_id=?')
    .bind(observedAt, new Date(Date.now() + 300_000).toISOString(), guildId)
    .run();
  assert.equal((await profile()).includes('Not in LVBT Discord'), true);
  assert.equal((await profile(welcomeSearch)).includes('Discord: not in server'), true);
  await exerciseProviderHistory(fixture, personId);
  unreachable = true;
  await fixture.db
    .prepare(
      "UPDATE provider_operation_receipts SET expires_at='2000-01-01T00:00:00.000Z' WHERE provider='discord'",
    )
    .run();
  assert.equal((await reconcileDiscordPending(fixture.db, options)).retry, 1);
  const unavailable = await profile();
  assert.equal(unavailable.includes('Member role not confirmed'), true);
  assert.equal(
    unavailable.includes('Member role removed'),
    false,
    'a timed-out current read must not keep presenting an older removal as current proof',
  );
  console.log(
    JSON.stringify({
      runtime: 'compiled staff Worker',
      checks: [
        'actual adapter read renders confirmed Member role',
        'verified member profile and roster show server presence separately from role state',
        'withdrawal hides stale confirmation immediately',
        'confirmed removal preserves unrelated role',
        'actual confirmed access changes render with automatic attribution and plain reasons',
        'administrator profile exposes confirmed history with native disclosure',
        'actual bounded provider timeout renders unknown instead of old role proof',
      ],
      provider: 'isolated fixture',
    }),
  );
} finally {
  await fixture.dispose();
}
