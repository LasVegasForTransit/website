import assert from 'node:assert/strict';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { enrollWorkspaceAccount } from '@lasvegasfortransit/platform-storage/workspace-enrollment';
import { createWorkspaceSession } from '@lasvegasfortransit/platform-storage/workspace-link';
import { chooseWorkspaceAccount } from '@lasvegasfortransit/platform-storage/staff-discord-handoff';
export async function onboardingFixture() {
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
  await chooseWorkspaceAccount(env, session.token);
  db.raw
    .prepare(
      "INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at) VALUES('discord',?,'discord','111111111111111111',?,'self_linked',?,?)",
    )
    .run(enrollment.personId, now.toISOString(), now.toISOString(), now.toISOString());
  db.raw
    .prepare(
      "INSERT INTO discord_profiles(identity_record_id,guild_id,in_guild,pending,observed_at,expires_at) VALUES('discord','222222222222222222',1,0,?,?)",
    )
    .run(
      new Date(now.getTime() - 600000).toISOString(),
      new Date(now.getTime() - 1000).toISOString(),
    );
  return { db, env, session, request, personId: enrollment.personId };
}
