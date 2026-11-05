import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memoryDb } from './support/db';
import { createWorkspaceSession } from '../src/workspace-session';
import { enrollWorkspaceAccount } from '../src/workspace-enrollment';
import {
  beginStaffDiscordHandoff,
  bindStaffDiscordBrowser,
  approveStaffDiscordHandoff,
  consumeStaffDiscordHandoff,
  staffDiscordSession,
} from '../src/staff-discord-handoff';
import { DiscordLinkService } from '../src/discord-link';
import { discordJoinIsCurrent } from '../src/discord-join';
import { loadDiscordPlan } from '../src/discord-plan';
const now = new Date('2026-11-04T20:00:00Z'),
  browser = 'b'.repeat(43);
async function fixture() {
  const db = memoryDb(),
    account = {
      customerId: 'C-lvbt',
      userId: 'google-discord',
      email: 'discord@lasvegasfortransit.org',
      givenName: 'Avery',
      familyName: 'Reyes',
      orgUnitId: 'ou-people',
      suspended: false,
      archived: false,
      deleted: false,
      observedAt: now.toISOString(),
    };
  const enrollment = await enrollWorkspaceAccount(
    db,
    account,
    {
      environment: 'production',
      customerId: 'C-lvbt',
      humanOrgUnitIds: ['ou-people'],
      includedUserIds: [],
      excludedUserIds: [],
      previewUserIds: [],
    },
    now,
  );
  const staffEnv = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'staff-secret' },
    publicEnv = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'public-secret' };
  const staff = await createWorkspaceSession(
    staffEnv,
    { subject: account.userId, email: account.email, givenName: 'Avery', familyName: 'Reyes' },
    now,
  );
  assert.ok(staff);
  const ticket = await beginStaffDiscordHandoff(staffEnv, staff.token, {
    staffOrigin: 'https://staff.lasvegasfortransit.org',
    memberOrigin: 'https://lasvegasfortransit.org',
    returnTo: '/paper/',
    now,
  });
  assert.ok(ticket);
  assert.ok(enrollment.personId);
  return { db, staffEnv, publicEnv, staff, ticket, personId: enrollment.personId };
}
async function approvedFixture() {
  const f = await fixture();
  await bindStaffDiscordBrowser(f.publicEnv, f.ticket, browser, now);
  const approval = await approveStaffDiscordHandoff(f.staffEnv, f.ticket, {
    staffToken: f.staff.token,
    browser,
    now,
  });
  assert.ok(approval);
  return { ...f, approval };
}
void test('raw ticket cannot create a public session; browser proof and fresh exact staff confirmation are required', async () => {
  const f = await fixture();
  assert.equal(await consumeStaffDiscordHandoff(f.publicEnv, f.ticket, browser, { now }), null);
  assert.equal(await bindStaffDiscordBrowser(f.publicEnv, f.ticket, browser, now), true);
  assert.equal(
    await approveStaffDiscordHandoff(f.staffEnv, f.ticket, {
      staffToken: 'x'.repeat(43),
      browser,
      now,
    }),
    null,
  );
  const approval = await approveStaffDiscordHandoff(f.staffEnv, f.ticket, {
    staffToken: f.staff.token,
    browser,
    now,
  });
  assert.ok(approval);
  assert.match(approval, /^[\w-]{43}$/);
  const saved = f.db.raw.prepare('SELECT approval_hash FROM staff_discord_handoffs').get();
  assert.ok(saved?.approval_hash);
  assert.notEqual(saved.approval_hash, approval);
  assert.equal(await consumeStaffDiscordHandoff(f.publicEnv, f.ticket, browser, { now }), null);
  assert.equal(
    await consumeStaffDiscordHandoff(f.publicEnv, f.ticket, browser, {
      approval: 'x'.repeat(43),
      now,
    }),
    null,
  );
  assert.equal(
    await consumeStaffDiscordHandoff(f.publicEnv, f.ticket, 'x'.repeat(43), { approval, now }),
    null,
  );
  const session = await consumeStaffDiscordHandoff(f.publicEnv, f.ticket, browser, {
    approval,
    now,
  });
  assert.ok(session);
  assert.equal(session.person_id, f.personId);
  assert.equal(
    await consumeStaffDiscordHandoff(f.publicEnv, f.ticket, browser, { approval, now }),
    null,
  );
  assert.equal(
    f.db.raw.prepare('SELECT approval_hash FROM staff_discord_handoffs').get()?.approval_hash,
    null,
  );
  assert.equal(await staffDiscordSession(f.staffEnv, session.token, now), null);
  assert.ok(await staffDiscordSession(f.publicEnv, session.token, now));
  f.db.raw.prepare("UPDATE workspace_directory_accounts SET state='inactive'").run();
  assert.equal(await staffDiscordSession(f.publicEnv, session.token, now), null);
});
void test('an expired or revoked staff proof cannot complete the handoff', async () => {
  const f = await approvedFixture();
  assert.equal(
    await consumeStaffDiscordHandoff(f.publicEnv, f.ticket, browser, {
      approval: f.approval,
      now: new Date(now.getTime() + 600_001),
    }),
    null,
  );
  f.db.raw.prepare('DELETE FROM sessions WHERE person_id=?').run(f.personId);
  assert.equal(
    await consumeStaffDiscordHandoff(f.publicEnv, f.ticket, browser, { approval: f.approval, now }),
    null,
  );
});
void test('team-only Discord linking and joining grants no Member or committee roles and records no consent', async () => {
  const f = await approvedFixture();
  const session = await consumeStaffDiscordHandoff(f.publicEnv, f.ticket, browser, {
    approval: f.approval,
    now,
  });
  assert.ok(session);
  const service = new DiscordLinkService(f.publicEnv);
  const started = await service.begin({
    sessionToken: session.token,
    origin: 'https://lasvegasfortransit.org',
    now,
  });
  assert.ok(started);
  const claim = await service.claim({
    sessionToken: session.token,
    origin: 'https://lasvegasfortransit.org',
    state: started.state,
    now,
  });
  assert.ok(claim);
  assert.equal(
    await service.complete({
      claim,
      identity: { id: '111111111111111111', username: 'avery', displayName: null, avatar: null },
      now,
    }),
    'linked',
  );
  assert.equal(
    await discordJoinIsCurrent(f.db, { personId: f.personId, discordId: '111111111111111111' }),
    true,
  );
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 0);
  assert.equal(
    f.db.raw.prepare('SELECT membership_status FROM people WHERE id=?').get(f.personId)
      ?.membership_status,
    'not_member',
  );
  const plan = await loadDiscordPlan(f.db, {
    personId: f.personId,
    guildId: '222222222222222222',
    memberRoleId: '333333333333333333',
  });
  assert.ok(plan);
  assert.deepEqual(plan.desiredRoleIds, []);
});
void test('revocation while Discord is verifying prevents the scoped session from linking', async () => {
  const f = await approvedFixture();
  const session = await consumeStaffDiscordHandoff(f.publicEnv, f.ticket, browser, {
    approval: f.approval,
    now,
  });
  assert.ok(session);
  const service = new DiscordLinkService(f.publicEnv),
    started = await service.begin({
      sessionToken: session.token,
      origin: 'https://lasvegasfortransit.org',
      now,
    });
  assert.ok(started);
  const claim = await service.claim({
    sessionToken: session.token,
    origin: 'https://lasvegasfortransit.org',
    state: started.state,
    now,
  });
  assert.ok(claim);
  f.db.raw
    .prepare('DELETE FROM sessions WHERE person_id=? AND id_hash<>?')
    .run(f.personId, claim.sessionHash);
  assert.equal(
    await service.complete({
      claim,
      identity: { id: '111111111111111111', username: 'avery', displayName: null, avatar: null },
      now,
    }),
    'failed',
  );
});

void test('deferral and completed disconnection stay respected, while valid server links are reused only in the selected guild', async () => {
  const { deferStaffDiscord, staffDiscordReadiness } = await import('../src/staff-discord-handoff');
  const f = await fixture();
  await deferStaffDiscord(f.staffEnv, f.personId, now);
  assert.equal(
    (await staffDiscordReadiness(f.staffEnv, f.personId, '222222222222222222', now))?.deferred_at,
    now.toISOString(),
  );
  f.db.raw
    .prepare(
      "INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at) VALUES('existing',?,'discord','111111111111111111',?,'self_linked',?,?)",
    )
    .run(f.personId, now.toISOString(), now.toISOString(), now.toISOString());
  f.db.raw
    .prepare(
      "INSERT INTO discord_profiles(identity_record_id,guild_id,in_guild,pending,observed_at,expires_at) VALUES('existing','222222222222222222',1,0,?,?)",
    )
    .run(now.toISOString(), new Date(now.getTime() + 600_000).toISOString());
  assert.equal(
    (await staffDiscordReadiness(f.staffEnv, f.personId, '222222222222222222', now))?.in_guild,
    1,
  );
  assert.equal(
    (await staffDiscordReadiness(f.staffEnv, f.personId, '444444444444444444', now))?.in_guild,
    0,
  );
  f.db.raw.prepare('UPDATE discord_profiles SET in_guild=0').run();
  assert.equal(
    (await staffDiscordReadiness(f.staffEnv, f.personId, '222222222222222222', now))?.in_guild,
    0,
  );
  f.db.raw
    .prepare(
      "INSERT INTO staff_audits(id,actor_id,action,target_id,occurred_at) VALUES('disconnect',?,'identity.discord_disconnect',?,?)",
    )
    .run(f.personId, f.personId, now.toISOString());
  assert.equal(
    (await staffDiscordReadiness(f.staffEnv, f.personId, '222222222222222222', now))?.disconnected,
    1,
  );
});

void test('a substituted portal return cannot give the attacker browser a scoped session after the owner confirms', async () => {
  const f = await fixture(),
    attackerBrowser = 'a'.repeat(43),
    ownerBrowser = 'o'.repeat(43);
  assert.equal(await bindStaffDiscordBrowser(f.publicEnv, f.ticket, attackerBrowser, now), true);
  // After the owner posts their intent, the browser-return GET carries the substituted value.
  // Only that live staff browser receives the fresh, unpredictable approval capability.
  const ownerApproval = await approveStaffDiscordHandoff(f.staffEnv, f.ticket, {
    staffToken: f.staff.token,
    browser: attackerBrowser,
    now,
  });
  assert.ok(ownerApproval);
  // The initial ticket and attacker's bound cookie are still insufficient.
  assert.equal(
    await consumeStaffDiscordHandoff(f.publicEnv, f.ticket, attackerBrowser, { now }),
    null,
  );
  assert.equal(
    await consumeStaffDiscordHandoff(f.publicEnv, f.ticket, attackerBrowser, {
      approval: 'x'.repeat(43),
      now,
    }),
    null,
  );
  // The owner's redirect carries the capability but its public browser has a
  // different host-only cookie, so substitution fails on that browser too.
  assert.equal(
    await consumeStaffDiscordHandoff(f.publicEnv, f.ticket, ownerBrowser, {
      approval: ownerApproval,
      now,
    }),
    null,
  );
  assert.equal(
    f.db.raw.prepare('SELECT count(*) AS n FROM sessions WHERE authentication_source IS NULL').get()
      ?.n,
    0,
  );
});

void test('required setup resumes only the exact live session account choice and never skips Discord', async () => {
  const { staffOnboardingStep, chooseWorkspaceAccount } =
    await import('../src/staff-discord-handoff');
  const f = await fixture();
  const step = () => staffOnboardingStep(f.staffEnv, f.staff.token, '222222222222222222', now);
  assert.equal(await step(), 'account');
  assert.equal(await chooseWorkspaceAccount(f.staffEnv, 'x'.repeat(43), now), false);
  assert.equal(await chooseWorkspaceAccount(f.staffEnv, f.staff.token, now), true);
  assert.equal(await step(), 'discord');
  const other = await createWorkspaceSession(
    f.staffEnv,
    {
      subject: 'google-discord',
      email: 'discord@lasvegasfortransit.org',
      givenName: 'Avery',
      familyName: 'Reyes',
    },
    now,
  );
  assert.ok(other);
  assert.equal(
    await staffOnboardingStep(f.staffEnv, other.token, '222222222222222222', now),
    'account',
    'a different live session cannot inherit the choice',
  );
  const { deferStaffDiscord } = await import('../src/staff-discord-handoff');
  await deferStaffDiscord(f.staffEnv, f.personId, now);
  assert.equal(
    await step(),
    'discord',
    'old deferral and cancellation cannot bypass the required step',
  );
  f.db.raw
    .prepare(
      "INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at) VALUES('ready',?,'discord','111111111111111111',?,'self_linked',?,?)",
    )
    .run(f.personId, now.toISOString(), now.toISOString(), now.toISOString());
  f.db.raw
    .prepare(
      "INSERT INTO discord_profiles(identity_record_id,guild_id,in_guild,pending,observed_at,expires_at) VALUES('ready','222222222222222222',1,1,?,?)",
    )
    .run(now.toISOString(), new Date(now.getTime() + 600000).toISOString());
  assert.equal(await step(), 'screening');
  f.db.raw.prepare('UPDATE discord_profiles SET pending=0').run();
  assert.equal(await step(), 'ready');
  assert.equal(
    await staffOnboardingStep(f.staffEnv, f.staff.token, '444444444444444444', now),
    'discord',
  );
  f.db.raw.prepare("DELETE FROM identities WHERE id='ready'").run();
  assert.equal(await step(), 'discord', 'disconnect requires another explicit Connect action');
  f.db.raw.prepare('DELETE FROM sessions WHERE person_id=?').run(f.personId);
  assert.equal(await step(), 'pending');
});

void test('an existing immutable association skips the choice; missing Directory association stays pending', async () => {
  const { staffOnboardingStep } = await import('../src/staff-discord-handoff');
  const f = await fixture();
  f.db.raw.prepare('UPDATE workspace_directory_accounts SET provisional=0').run();
  assert.equal(
    await staffOnboardingStep(f.staffEnv, f.staff.token, '222222222222222222', now),
    'discord',
  );
  f.db.raw.prepare('DELETE FROM workspace_directory_accounts').run();
  assert.equal(
    await staffOnboardingStep(f.staffEnv, f.staff.token, '222222222222222222', now),
    'pending',
  );
});
