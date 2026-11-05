import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSession } from '@lasvegasfortransit/platform-storage/auth';
import { createWorkspaceSession } from '@lasvegasfortransit/platform-storage/workspace-link';
import { enrollWorkspaceAccount } from '@lasvegasfortransit/platform-storage/workspace-enrollment';
import {
  beginWorkspaceConnection,
  approveWorkspaceConnection,
  completeWorkspaceConnection,
} from '@lasvegasfortransit/platform-storage/workspace-enrollment-connect';
import { d1Fixture } from './support/d1';
const now = new Date('2026-11-04T20:00:00Z');

async function fixture() {
  const f = await d1Fixture();
  try {
    const { db } = f;
    const account = {
      customerId: 'C-lvbt',
      userId: 'google-transfer',
      email: 'team@lasvegasfortransit.org',
      givenName: 'Avery',
      familyName: 'Reyes',
      orgUnitId: 'people',
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
        customerId: account.customerId,
        humanOrgUnitIds: ['people'],
        includedUserIds: [],
        excludedUserIds: [],
        previewUserIds: [],
      },
      now,
    );
    assert.ok(enrollment.personId);
    const source = enrollment.personId;
    const staffEnv = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'staff-secret' };
    const memberEnv = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'member-secret' };
    await db
      .prepare(
        "INSERT INTO people(id,email,membership_status,created_at,updated_at) VALUES('member','personal@example.org','member',?,?)",
      )
      .bind(now.toISOString(), now.toISOString())
      .run();
    await db
      .prepare(
        "INSERT INTO consent_records(id,person_id,scope,given_at,source,method,created_at,updated_at) VALUES('consent','member','newsletter',?,'join_form','checkbox',?,?)",
      )
      .bind(now.toISOString(), now.toISOString(), now.toISOString())
      .run();
    const staff = await createWorkspaceSession(
      staffEnv,
      { subject: account.userId, email: account.email, givenName: 'Avery', familyName: 'Reyes' },
      now,
    );
    assert.ok(staff);
    const member = await createSession(memberEnv, 'member', 'member', now);
    const ticket = await beginWorkspaceConnection(staffEnv, staff.token, {
      staffOrigin: 'https://staff.lasvegasfortransit.org',
      memberOrigin: 'https://lasvegasfortransit.org',
      now,
    });
    assert.ok(ticket);
    assert.equal(await approveWorkspaceConnection(memberEnv, ticket, member.token, now), true);
    return { ...f, source, staffEnv, staff, ticket };
  } catch (error) {
    await f.close();
    throw error;
  }
}
void test('real D1 transfers an empty provisional account under its expression-depth limit', async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await completeWorkspaceConnection(f.staffEnv, f.ticket, f.staff.token, now)).kind,
      'connected',
    );
    assert.equal(
      (await f.db.prepare('SELECT person_id FROM workspace_enrollments').first())?.person_id,
      'member',
    );
    assert.ok(
      (await f.db.prepare('SELECT deleted_at FROM people WHERE id=?').bind(f.source).first())
        ?.deleted_at,
    );
    assert.deepEqual(
      await f.db.prepare("SELECT email,membership_status FROM people WHERE id='member'").first(),
      { email: 'personal@example.org', membership_status: 'member' },
    );
    assert.equal(
      (await f.db.prepare("SELECT person_id FROM consent_records WHERE id='consent'").first())
        ?.person_id,
      'member',
    );
    assert.equal(
      (
        await f.db
          .prepare('SELECT count(*) AS n FROM sessions WHERE person_id=?')
          .bind(f.source)
          .first()
      )?.n,
      0,
    );
  } finally {
    await f.close();
  }
});
for (const conflict of ['activity', 'discord-history', 'destination-identity', 'revoked-proof']) {
  void test(`real D1 rolls back the complete transfer when ${conflict} arrives after approval`, async () => {
    const f = await fixture();
    try {
      if (conflict === 'activity')
        await f.db
          .prepare(
            "INSERT INTO engagement_events(id,person_id,type,occurred_at,source,created_at) VALUES('activity',?,'event_attended',?,'staff',?)",
          )
          .bind(f.source, now.toISOString(), now.toISOString())
          .run();
      if (conflict === 'discord-history')
        await f.db
          .prepare(
            "INSERT INTO staff_audits(id,actor_id,action,target_id,occurred_at) VALUES('disconnect',?,'identity.discord_disconnect',?,?)",
          )
          .bind(f.source, f.source, now.toISOString())
          .run();
      if (conflict === 'destination-identity')
        await f.db
          .prepare(
            "INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at) VALUES('other','member','google_workspace','other',?,'self_linked',?,?)",
          )
          .bind(now.toISOString(), now.toISOString(), now.toISOString())
          .run();
      if (conflict === 'revoked-proof')
        await f.db.prepare("DELETE FROM sessions WHERE person_id='member'").run();
      assert.equal(
        (await completeWorkspaceConnection(f.staffEnv, f.ticket, f.staff.token, now)).kind,
        'conflict',
      );
      assert.equal(
        (await f.db.prepare('SELECT person_id FROM workspace_enrollments').first())?.person_id,
        f.source,
      );
      assert.equal(
        (await f.db.prepare('SELECT deleted_at FROM people WHERE id=?').bind(f.source).first())
          ?.deleted_at,
        null,
      );
      assert.equal(
        (await f.db.prepare('SELECT consumed_at FROM workspace_account_connections').first())
          ?.consumed_at,
        null,
      );
      assert.equal(
        (
          await f.db
            .prepare('SELECT count(*) AS n FROM sessions WHERE person_id=?')
            .bind(f.source)
            .first()
        )?.n,
        1,
      );
      assert.equal(
        (
          await f.db
            .prepare(
              "SELECT count(*) AS n FROM staff_audits WHERE action='workspace.account_connected'",
            )
            .first()
        )?.n,
        0,
      );
    } finally {
      await f.close();
    }
  });
}
