import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memoryDb } from './support/db';
import { createSession } from '../src/auth';
import { createWorkspaceSession } from '../src/workspace-session';
import { enrollWorkspaceAccount } from '../src/workspace-enrollment';
import {
  beginWorkspaceConnection,
  approveWorkspaceConnection,
  completeWorkspaceConnection,
} from '../src/workspace-enrollment-connect';

const now = new Date('2026-11-04T20:00:00Z');
async function fixture() {
  const db = memoryDb();
  const account = {
    customerId: 'C-lvbt',
    userId: 'google-connect',
    email: 'new@lasvegasfortransit.org',
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
  const staffEnv = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-staff-secret' };
  const memberEnv = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-member-secret' };
  db.raw
    .prepare(
      "INSERT INTO people(id,email,membership_status,created_at,updated_at) VALUES('member','personal@example.org','member',?,?)",
    )
    .run(now.toISOString(), now.toISOString());
  const staff = await createWorkspaceSession(
    staffEnv,
    { subject: account.userId, email: account.email, givenName: 'Avery', familyName: 'Reyes' },
    now,
  );
  assert.ok(staff);
  const member = await createSession(memberEnv, 'member', 'member', now);
  const ticket = await beginWorkspaceConnection(staffEnv, staff.token, {
    memberOrigin: 'https://lasvegasfortransit.org',
    staffOrigin: 'https://staff.lasvegasfortransit.org',
    now,
  });
  assert.ok(ticket);
  assert.ok(enrollment.personId);
  return { db, staffEnv, memberEnv, staff, member, ticket, source: enrollment.personId };
}

void test('both live account proofs move only an empty provisional enrollment and consume the connection', async () => {
  const f = await fixture();
  assert.equal(await approveWorkspaceConnection(f.memberEnv, f.ticket, f.member.token, now), true);
  const result = await completeWorkspaceConnection(f.staffEnv, f.ticket, f.staff.token, now);
  assert.equal(result.kind, 'connected');
  assert.equal(
    f.db.raw.prepare("SELECT person_id FROM identities WHERE platform='google_workspace'").get()
      ?.person_id,
    'member',
  );
  assert.equal(
    f.db.raw.prepare('SELECT person_id FROM workspace_enrollments').get()?.person_id,
    'member',
  );
  assert.ok(f.db.raw.prepare('SELECT deleted_at FROM people WHERE id=?').get(f.source)?.deleted_at);
  assert.equal(
    f.db.raw.prepare("SELECT email FROM people WHERE id='member'").get()?.email,
    'personal@example.org',
  );
  assert.notEqual(
    (await completeWorkspaceConnection(f.staffEnv, f.ticket, f.staff.token, now)).kind,
    'connected',
  );
});

void test('a missing proof or another browser staff session cannot move the enrollment', async () => {
  const f = await fixture();
  assert.notEqual(
    (await completeWorkspaceConnection(f.staffEnv, f.ticket, f.staff.token, now)).kind,
    'connected',
  );
  await approveWorkspaceConnection(f.memberEnv, f.ticket, f.member.token, now);
  const other = await createSession(f.staffEnv, f.source, 'staff', now);
  assert.notEqual(
    (await completeWorkspaceConnection(f.staffEnv, f.ticket, other.token, now)).kind,
    'connected',
  );
  assert.equal(
    f.db.raw.prepare('SELECT person_id FROM workspace_enrollments').get()?.person_id,
    f.source,
  );
});

void test('independent team activity prevents provisional transfer even with both proofs', async () => {
  const f = await fixture();
  f.db.raw
    .prepare(
      "INSERT INTO engagement_events(id,person_id,type,occurred_at,source,created_at) VALUES('activity',?,'event_attended',?,'staff',?)",
    )
    .run(f.source, now.toISOString(), now.toISOString());
  await approveWorkspaceConnection(f.memberEnv, f.ticket, f.member.token, now);
  assert.equal(
    (await completeWorkspaceConnection(f.staffEnv, f.ticket, f.staff.token, now)).kind,
    'conflict',
  );
  assert.equal(
    f.db.raw.prepare('SELECT person_id FROM workspace_enrollments').get()?.person_id,
    f.source,
  );
});

void test('expiry and either revoked account proof refuse the connection', async () => {
  const expired = await fixture();
  await approveWorkspaceConnection(expired.memberEnv, expired.ticket, expired.member.token, now);
  assert.equal(
    (
      await completeWorkspaceConnection(
        expired.staffEnv,
        expired.ticket,
        expired.staff.token,
        new Date(now.getTime() + 600_001),
      )
    ).kind,
    'expired',
  );
  const revoked = await fixture();
  await approveWorkspaceConnection(revoked.memberEnv, revoked.ticket, revoked.member.token, now);
  revoked.db.raw.prepare("DELETE FROM sessions WHERE person_id='member'").run();
  assert.equal(
    (await completeWorkspaceConnection(revoked.staffEnv, revoked.ticket, revoked.staff.token, now))
      .kind,
    'conflict',
  );
});
void test('consent, assignments, privileged grants and conflicting identities each refuse automatic transfer', async () => {
  for (const kind of ['consent', 'assignment', 'administrator', 'identity', 'destination']) {
    const f = await fixture();
    if (kind === 'consent')
      f.db.raw
        .prepare(
          "INSERT INTO consent_records(id,person_id,scope,given_at,source,method,created_at,updated_at) VALUES('consent',?,'newsletter',?,'join_form','checkbox',?,?)",
        )
        .run(f.source, now.toISOString(), now.toISOString(), now.toISOString());
    if (kind === 'assignment')
      f.db.raw
        .prepare(
          "INSERT INTO committee_assignments(id,person_id,committee_id,role,started_at,assigned_by,updated_at) VALUES('assignment',?,'events','member',?,'member',?)",
        )
        .run(f.source, now.toISOString(), now.toISOString());
    if (kind === 'administrator')
      f.db.raw
        .prepare(
          "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES(?,'member',?)",
        )
        .run(f.source, now.toISOString());
    if (kind === 'identity' || kind === 'destination')
      f.db.raw
        .prepare(
          "INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at) VALUES('other',?,?, 'other-external',?,'staff_confirmed',?,?)",
        )
        .run(
          kind === 'identity' ? f.source : 'member',
          kind === 'identity' ? 'discord' : 'google_workspace',
          now.toISOString(),
          now.toISOString(),
          now.toISOString(),
        );
    await approveWorkspaceConnection(f.memberEnv, f.ticket, f.member.token, now);
    assert.equal(
      (await completeWorkspaceConnection(f.staffEnv, f.ticket, f.staff.token, now)).kind,
      'conflict',
      kind,
    );
    assert.equal(
      f.db.raw.prepare('SELECT person_id FROM workspace_enrollments').get()?.person_id,
      f.source,
    );
  }
});
void test('a former member can connect for basic access without changing membership', async () => {
  const f = await fixture();
  f.db.raw.prepare("UPDATE people SET membership_status='former_member' WHERE id='member'").run();
  await approveWorkspaceConnection(f.memberEnv, f.ticket, f.member.token, now);
  assert.equal(
    (await completeWorkspaceConnection(f.staffEnv, f.ticket, f.staff.token, now)).kind,
    'connected',
  );
  assert.equal(
    f.db.raw.prepare("SELECT membership_status FROM people WHERE id='member'").get()
      ?.membership_status,
    'former_member',
  );
});

void test('completed Discord link and disconnect history makes a provisional record nonempty', async () => {
  const { DiscordLinkService } = await import('../src/discord-link');
  const { beginDiscordDisconnect, finishDiscordDisconnect } =
    await import('../src/discord-disconnect');
  const { loadDiscordPlan } = await import('../src/discord-plan');
  const { claimDiscordLease, saveDiscordSync } = await import('../src/discord-sync-store');
  const f = await fixture(),
    origin = 'https://lasvegasfortransit.org',
    service = new DiscordLinkService(f.staffEnv);
  const started = await service.begin({ sessionToken: f.staff.token, origin, now });
  assert.ok(started);
  const claim = await service.claim({
    sessionToken: f.staff.token,
    origin,
    state: started.state,
    now,
  });
  assert.ok(claim);
  assert.equal(
    await service.complete({
      claim,
      identity: {
        id: '111111111111111111',
        username: 'provisional',
        displayName: null,
        avatar: null,
      },
      now,
    }),
    'linked',
  );
  const identity = f.db.raw
    .prepare("SELECT id FROM identities WHERE person_id=? AND platform='discord'")
    .get(f.source);
  assert.ok(identity);
  assert.equal(typeof identity.id, 'string');
  assert.ok(
    await beginDiscordDisconnect(f.staffEnv, {
      sessionToken: f.staff.token,
      origin,
      identityRecordId: String(identity.id),
      operationId: 'provisional-disconnect',
      now,
    }),
  );
  const plan = await loadDiscordPlan(f.db, {
    personId: f.source,
    guildId: '222222222222222222',
    memberRoleId: '333333333333333333',
    operationId: 'provisional-disconnect',
  });
  assert.ok(plan);
  const lease = await claimDiscordLease(f.db, plan, now);
  assert.ok(lease);
  const input = { operationId: 'provisional-disconnect', plan, lease, now, member: null };
  assert.equal(await saveDiscordSync(f.db, input), true);
  assert.equal(await finishDiscordDisconnect(f.db, input), true);
  assert.equal(
    f.db.raw
      .prepare("SELECT count(*) AS n FROM identities WHERE person_id=? AND platform='discord'")
      .get(f.source)?.n,
    0,
  );
  assert.equal(
    f.db.raw
      .prepare(
        "SELECT count(*) AS n FROM staff_audits WHERE target_id=? AND action IN ('identity.discord_link','identity.discord_disconnect')",
      )
      .get(f.source)?.n,
    2,
  );
  await approveWorkspaceConnection(f.memberEnv, f.ticket, f.member.token, now);
  assert.equal(
    (await completeWorkspaceConnection(f.staffEnv, f.ticket, f.staff.token, now)).kind,
    'conflict',
  );
});
void test('an allowed empty transfer preserves a deferred onboarding choice and permits routine authentication audits', async () => {
  const f = await fixture();
  f.db.raw
    .prepare('INSERT INTO workspace_onboarding_choices(person_id,discord_deferred_at) VALUES(?,?)')
    .run(f.source, now.toISOString());
  f.db.raw
    .prepare(
      "INSERT INTO staff_audits(id,actor_id,action,target_id,occurred_at) VALUES('routine',?,'auth.staff_sign_in',?,?)",
    )
    .run(f.source, f.source, now.toISOString());
  await approveWorkspaceConnection(f.memberEnv, f.ticket, f.member.token, now);
  assert.equal(
    (await completeWorkspaceConnection(f.staffEnv, f.ticket, f.staff.token, now)).kind,
    'connected',
  );
  assert.equal(
    f.db.raw
      .prepare(
        "SELECT discord_deferred_at FROM workspace_onboarding_choices WHERE person_id='member'",
      )
      .get()?.discord_deferred_at,
    now.toISOString(),
  );
});
