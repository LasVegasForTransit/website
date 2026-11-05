import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { enrollWorkspaceAccount } from '@lasvegasfortransit/platform-storage/workspace-enrollment';
import { createWorkspaceSession } from '@lasvegasfortransit/platform-storage/workspace-link';
import { chooseWorkspaceAccount } from '@lasvegasfortransit/platform-storage/staff-discord-handoff';
import { resolveStaffContext } from '../src/lib/context';
void test('required setup protects team tools through choice, Discord and screening, and rechecks departure', async () => {
  const db = memoryDb(),
    now = new Date();
  const env = {
    PLATFORM_DB: db,
    LVBT_SIGN_IN_SECRET: 'test',
    LVBT_STAFF_AUTH_MODE: 'google',
    LVBT_STAFF_DISCORD_REQUIRED: 'true',
    LVBT_DEPLOYMENT_ENV: 'production',
    LVBT_DISCORD_SYNC_ENABLED: 'true',
    LVBT_DISCORD_GUILD_ID: '222222222222222222',
    LVBT_DISCORD_PRODUCTION_GUILD_ID: '222222222222222222',
    LVBT_DISCORD_APPLICATION_ID: '333333333333333333',
    LVBT_DISCORD_MEMBER_ROLE_ID: '444444444444444444',
  };
  const enrollment = await enrollWorkspaceAccount(
    db,
    {
      customerId: 'test',
      userId: 'team',
      email: 'team@lasvegasfortransit.org',
      givenName: 'Avery',
      familyName: 'Reyes',
      orgUnitId: 'people',
      suspended: false,
      archived: false,
      deleted: false,
      observedAt: now.toISOString(),
    },
    {
      environment: 'production',
      customerId: 'test',
      humanOrgUnitIds: ['people'],
      includedUserIds: [],
      excludedUserIds: [],
      previewUserIds: [],
    },
    now,
  );
  const session = await createWorkspaceSession(
    env,
    {
      subject: 'team',
      email: 'team@lasvegasfortransit.org',
      givenName: 'Avery',
      familyName: 'Reyes',
    },
    now,
  );
  assert.ok(session);
  assert.ok(enrollment.personId);
  const request = () =>
    new Request('https://staff.lasvegasfortransit.org/paper/sheet/?event=123', {
      headers: { Cookie: `__Host-lvbt_session=${session.token}` },
    });
  async function gated() {
    const response = await resolveStaffContext(request(), env);
    assert.ok(response instanceof Response);
    assert.equal(response.status, 303);
    assert.equal(
      response.headers.get('Location'),
      '/onboarding/?next=%2Fpaper%2Fsheet%2F%3Fevent%3D123',
    );
  }
  await gated();
  await chooseWorkspaceAccount(env, session.token);
  await gated();
  db.raw
    .prepare(
      "INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at) VALUES('discord',?,'discord','111111111111111111',?,'self_linked',?,?)",
    )
    .run(enrollment.personId, now.toISOString(), now.toISOString(), now.toISOString());
  db.raw
    .prepare(
      "INSERT INTO discord_profiles(identity_record_id,guild_id,in_guild,pending,observed_at,expires_at) VALUES('discord','222222222222222222',1,1,?,?)",
    )
    .run(now.toISOString(), new Date(now.getTime() + 600000).toISOString());
  await gated();
  db.raw.prepare('UPDATE discord_profiles SET pending=0').run();
  const ready = await resolveStaffContext(request(), env);
  assert.ok(!(ready instanceof Response));
  assert.equal(ready.actor.personId, enrollment.personId);
  db.raw.prepare('UPDATE discord_profiles SET in_guild=0').run();
  await gated();
  const staged = await resolveStaffContext(request(), {
    ...env,
    LVBT_STAFF_DISCORD_REQUIRED: 'false',
  });
  assert.ok(!(staged instanceof Response));
  db.raw.close();
});
