import assert from 'node:assert/strict';
import test from 'node:test';
import { hashWithSecret } from '@lasvegasfortransit/platform-core/signing';
import { createSession } from '@lasvegasfortransit/platform-storage/auth';
import { createWorkspaceSession } from '@lasvegasfortransit/platform-storage/workspace-link';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { onRequestPost } from '../functions/account/data';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { exportData } from '../platform/account-data';

const stamp = '2026-10-01T10:00:00.000Z';
async function fixture() {
  const db = memoryDb();
  const people = new PersonService(db);
  const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'export-fixture-only' };
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'member@example.invalid', given_name: 'Rider' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'join-form-v1',
      givenAt: stamp,
    },
  });
  const { person: other } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'other-private@example.invalid' },
  });
  const session = await createSession(env, person.id, 'member');
  const authority = {
    kind: 'member' as const,
    personId: person.id,
    sessionHash: await hashWithSecret(env.LVBT_SIGN_IN_SECRET, `session:${session.token}`),
  };
  return { db, people, env, person, other, authority, session };
}

void test('a personal export redacts arbitrary activity and merge references while retaining the person’s activity', async () => {
  const { db, people, person, other, authority } = await fixture();
  try {
    await people.recordEngagement(person.id, {
      type: 'duplicate_reviewed',
      occurredAt: stamp,
      source: `merge-internal-${other.id}`,
      reference: `merge-${other.id}`,
      details: {
        actorId: other.id,
        survivorId: other.id,
        email: other.email,
        nested: { secret: 'private-receipt' },
      },
    });
    const data = await exportData(db, person.id, authority);
    assert.ok(data);
    const text = JSON.stringify(data);
    assert.equal(text.includes(other.id), false);
    assert.equal(text.includes(other.email ?? ''), false);
    assert.equal(text.includes('private-receipt'), false);
    assert.equal(text.includes('duplicate_reviewed'), true);
    assert.equal(text.includes('member@example.invalid'), true);
  } finally {
    db.raw.close();
  }
});

void test('personal activity retains typed donation, attendance, RSVP and volunteer facts while excluding private payloads', async () => {
  const { db, people, person, other, authority } = await fixture();
  try {
    const privateDetails = {
      actorId: other.id,
      personId: other.id,
      mergedPersonId: other.id,
      note: other.email,
      reason: 'private-staff-reason',
      raw: { email: other.email },
    };
    const facts = [
      { type: 'donated' as const, facts: { amount: 4321, currency: 'USD' } },
      {
        type: 'attended' as const,
        facts: {
          eventName: 'Transit meetup',
          eventDate: '2026-10-01',
          location: 'Community center',
          datePrecision: 'day',
          newsletterConsent: true,
        },
      },
      { type: 'rsvp' as const, facts: { eventName: 'Transit meetup', response: 'going' } },
      {
        type: 'volunteer_shift' as const,
        facts: {
          eventName: 'Transit meetup',
          shiftName: 'Welcome table',
          startedAt: '2026-10-01T10:00:00.000Z',
          endedAt: '2026-10-01T12:00:00.000Z',
          hours: 2,
        },
      },
      { type: 'welcomed' as const, facts: { method: 'email' } },
      {
        type: 'role_changed' as const,
        facts: { oldRole: 'member', newRole: 'lead', endReason: null },
      },
    ];
    for (const entry of facts)
      await people.recordEngagement(person.id, {
        type: entry.type,
        occurredAt: stamp,
        source: 'staff',
        reference: other.id,
        details: { ...entry.facts, ...privateDetails },
      });
    const data = await exportData(db, person.id, authority);
    assert.ok(data);
    const activity = data.activity as { type: string; facts?: Record<string, unknown> }[];
    for (const entry of facts)
      assert.deepEqual(
        activity.find((event) => event.type === entry.type)?.facts,
        entry.facts,
        entry.type,
      );
    for (const privateValue of [
      other.id,
      other.email,
      'private-staff-reason',
      'actorId',
      'mergedPersonId',
      '"raw":',
    ]) {
      assert.ok(privateValue);
      assert.equal(JSON.stringify(data).includes(privateValue), false, privateValue);
    }
  } finally {
    db.raw.close();
  }
});

void test('activity facts reject nested values, invalid amounts and identity-shaped labels', async () => {
  const { db, people, person, other, authority } = await fixture();
  try {
    await people.recordEngagement(person.id, {
      type: 'donated',
      occurredAt: stamp,
      source: 'staff',
      details: { amount: { private: other.email }, currency: other.email, eventName: other.id },
    });
    await people.recordEngagement(person.id, {
      type: 'attended',
      occurredAt: stamp,
      source: 'staff',
      details: {
        eventName: other.id,
        location: other.email,
        eventDate: 'not-a-date',
        datePrecision: other.id,
      },
    });
    await people.recordEngagement(person.id, {
      type: 'correction',
      occurredAt: stamp,
      source: 'staff',
      details: {
        eventName: 'private-correction',
        note: other.email,
        changes: [{ field: 'email', before: other.email }],
      },
    });
    const data = await exportData(db, person.id, authority);
    assert.ok(data);
    const activity = data.activity as { type: string; facts?: Record<string, unknown> }[];
    for (const type of ['donated', 'attended', 'correction'])
      assert.deepEqual(activity.find((event) => event.type === type)?.facts, {});
    for (const value of [other.id, other.email, 'private-correction']) {
      assert.ok(value);
      assert.equal(JSON.stringify(data).includes(value), false);
    }
  } finally {
    db.raw.close();
  }
});

void test('a personal export includes every profile field, withdrawal evidence and committee history without staff identifiers', async () => {
  const { db, people, person, other, authority } = await fixture();
  try {
    db.raw
      .prepare(
        "UPDATE people SET census_block_vintage='2020',region_source='staff',region_set_at=? WHERE id=?",
      )
      .run(stamp, person.id);
    db.raw
      .prepare(
        "INSERT INTO committee_assignments(id,person_id,committee_id,role,started_at,assigned_by,updated_at) VALUES('assignment',?,'events','member',?,?,?)",
      )
      .run(person.id, stamp, other.id, stamp);
    await people.withdrawConsent(person.id, {
      scope: 'newsletter',
      source: 'account',
      withdrawnAt: '2026-10-02T10:00:00.000Z',
    });
    const data = await exportData(db, person.id, authority);
    assert.ok(data);
    const details = data.details as Record<string, unknown>;
    assert.equal(details.census_block_vintage, '2020');
    assert.equal(details.region_source, 'staff');
    assert.equal(details.region_set_at, stamp);
    assert.equal(typeof details.email_verified_at, 'string');
    assert.equal((data.consent_withdrawals as unknown[]).length, 1);
    assert.equal((data.committee_assignments as unknown[]).length, 1);
    assert.equal(JSON.stringify(data).includes(other.id), false);
  } finally {
    db.raw.close();
  }
});

void test('a personal export rejects another person’s session and a revoked session', async () => {
  const { db, person, other, authority } = await fixture();
  try {
    assert.equal(await exportData(db, other.id, authority), null);
    db.raw.prepare('DELETE FROM sessions WHERE person_id=?').run(person.id);
    assert.equal(await exportData(db, person.id, authority), null);
  } finally {
    db.raw.close();
  }
});

void test('a session revoked while a snapshot is collected receives no personal export', async () => {
  const { db, person, authority } = await fixture();
  try {
    const racing: Db = {
      prepare: (sql) => db.prepare(sql),
      batch: async (statements) => {
        const snapshot = await db.batch(statements);
        db.raw.prepare('DELETE FROM sessions WHERE person_id=?').run(person.id);
        return snapshot;
      },
    };
    assert.equal(await exportData(racing, person.id, authority), null);
  } finally {
    db.raw.close();
  }
});

void test('administrator exports require current designation, membership and the same linked Workspace identity', async () => {
  for (const change of ['designation', 'membership', 'identity', 'session', 'access_email']) {
    const { db, people, person, other, env } = await fixture();
    try {
      await people.linkIdentity(person.id, {
        platform: 'google_workspace',
        externalId: 'admin-workspace',
        externalEmail: 'admin@lasvegasfortransit.org',
        linkMethod: 'self_linked',
      });
      db.raw
        .prepare(
          'INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES(?,?,?)',
        )
        .run(person.id, 'fixture', stamp);
      db.raw
        .prepare(
          'INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES(?,?,?)',
        )
        .run(other.id, 'fixture', stamp);
      const session = await createWorkspaceSession(env, {
        subject: 'admin-workspace',
        email: 'admin@lasvegasfortransit.org',
        givenName: null,
        familyName: null,
      });
      assert.ok(session);
      const authority = {
        kind: 'administrator' as const,
        personId: person.id,
        workspaceEmail: 'admin@lasvegasfortransit.org',
        sessionHash: await hashWithSecret(env.LVBT_SIGN_IN_SECRET, `session:${session.token}`),
      };
      assert.ok(await exportData(db, other.id, authority));
      if (change === 'designation')
        db.raw.prepare('DELETE FROM staff_administrators WHERE person_id=?').run(person.id);
      if (change === 'membership')
        db.raw
          .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
          .run(person.id);
      if (change === 'identity')
        db.raw
          .prepare("UPDATE identities SET person_id=? WHERE platform='google_workspace'")
          .run(other.id);
      if (change === 'session')
        db.raw.prepare('DELETE FROM sessions WHERE person_id=?').run(person.id);
      if (change === 'access_email') authority.workspaceEmail = 'different@lasvegasfortransit.org';
      assert.equal(await exportData(db, other.id, authority), null, change);
    } finally {
      db.raw.close();
    }
  }
});

void test('personal exports retain newsletter evidence without inbox addresses, delivery receipts or unrelated subscriptions', async () => {
  const { db, people, person, other, authority } = await fixture();
  try {
    assert.ok(person.email);
    assert.ok(other.email);
    await people.linkIdentity(person.id, {
      platform: 'beehiiv',
      externalId: 'sub_member',
      externalEmail: person.email,
      linkMethod: 'verified_email',
    });
    await people.linkIdentity(other.id, {
      platform: 'beehiiv',
      externalId: 'sub_other_private',
      externalEmail: other.email,
      linkMethod: 'verified_email',
    });
    const at = new Date().toISOString();
    db.raw
      .prepare(
        "INSERT INTO beehiiv_poll_checkpoints(publication_id,started_at,next_scan_at,next_attempt_at,in_progress) VALUES('pub_fixture',?,?,?,0)",
      )
      .run(at, at, at);
    for (const subscription of ['sub_member', 'sub_other_private']) {
      db.raw
        .prepare(
          "INSERT INTO beehiiv_subscription_observations(publication_id,subscription_id,status,subscription_created_at,observed_at,last_scan_started_at) VALUES('pub_fixture',?,'inactive',?,?,?)",
        )
        .run(subscription, stamp, at, at);
      db.raw
        .prepare(
          "INSERT INTO newsletter_inbound_events(publication_id,id,fingerprint,type,occurred_at,subscription_id,email_key,encrypted_email,received_at) VALUES('pub_fixture',?,?,'subscription.deleted',?,?, 'address-private-key','encrypted-private-address',?)",
        )
        .run(`event-${subscription}`, `fingerprint-${subscription}`, stamp, subscription, at);
    }
    const data = await exportData(db, person.id, authority);
    assert.ok(data);
    assert.equal((data.newsletter_observations as unknown[]).length, 1);
    assert.equal((data.newsletter_choices as unknown[]).length, 1);
    assert.equal((data.newsletter_source_events as unknown[]).length, 1);
    for (const privateValue of [
      'sub_other_private',
      'encrypted-private-address',
      'address-private-key',
      'fingerprint-',
      'event-sub_',
      'pub_fixture',
    ])
      assert.equal(JSON.stringify(data).includes(privateValue), false, privateValue);
  } finally {
    db.raw.close();
  }
});

void test('the account download is private JSON and refuses a session revoked after the account lookup', async () => {
  const { db, person, env, session } = await fixture();
  try {
    const request = () =>
      new Request('https://lasvegasfortransit.org/account/data/', {
        method: 'POST',
        headers: {
          Origin: 'https://lasvegasfortransit.org',
          Cookie: `__Host-lvbt_session=${session.token}`,
        },
      });
    const response = await onRequestPost({ env, request: request() } as unknown as Parameters<
      typeof onRequestPost
    >[0]);
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get('Content-Disposition') ?? '',
      /^attachment; filename="lvbt-my-data-/,
    );
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
    const downloaded = await response.json<{ details: { id: string } }>();
    assert.equal(downloaded.details.id, person.id);
    const racing: Db = {
      prepare: (sql) => db.prepare(sql),
      batch: async (statements) => {
        db.raw.prepare('DELETE FROM sessions WHERE person_id=?').run(person.id);
        return db.batch(statements);
      },
    };
    const rejected = await onRequestPost({
      env: { ...env, PLATFORM_DB: racing },
      request: request(),
    } as unknown as Parameters<typeof onRequestPost>[0]);
    assert.equal(rejected.status, 303);
    assert.equal(rejected.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(await rejected.text(), '');
  } finally {
    db.raw.close();
  }
});
