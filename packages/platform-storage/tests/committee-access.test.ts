import assert from 'node:assert/strict';
import test from 'node:test';
import { groupEmail, now } from './support/google-group-overview-fixture';
import { recordAccessObservation } from '../src/access-observations';
import { getGoogleGroupReview } from '../src/google-group-overview';
import { saveGoogleGroupSnapshot } from '../src/google-group-snapshots';
import { loadActor } from '../src/staff-roles';
import { PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';
import { fixture, guild, role } from './support/committee-access-fixture';
void test('committee overview combines Google and Discord differences and keeps unknown accounts distinct', async () => {
  const f = await fixture();
  try {
    const page = await f.listCommitteeAccessOverview(f.db, f.actor, {
      configuration: f.configuration,
      consoleGroupEmail: f.query.consoleGroupEmail,
      now,
    });
    const events = page.items.find((r) => r.id === 'events');
    assert.ok(events);
    assert.equal(events.expectedPeople, 2);
    assert.equal(events.google.resourceId, groupEmail);
    assert.equal(events.google.holders, 2);
    assert.equal(events.google.missing, 1);
    assert.equal(events.google.unexpected, 1);
    assert.equal(events.google.unconfirmed, 1);
    assert.equal(events.google.unmatched, 1);
    assert.equal(events.discord.holders, 1);
    assert.equal(events.discord.missing, 1);
    assert.equal(events.discord.unexpected, 1);
    assert.equal(events.discord.unconfirmed, 1);
    assert.equal(events.discord.firstSeenAt, now.toISOString());
    const disabled = await f.listCommitteeAccessOverview(f.db, f.actor, {
      configuration: { discord: { ...f.configuration.discord, configured: false } },
      consoleGroupEmail: null,
      now,
    });
    assert.equal(disabled.items.find((r) => r.id === 'events')?.discord.holders, null);
  } finally {
    f.db.raw.close();
  }
});
void test('stored checks cannot confirm committee access after a role, account or administrator changes', async () => {
  const f = await fixture();
  try {
    f.db.raw
      .prepare("UPDATE committees SET discord_role_id='666666666666666666' WHERE id='events'")
      .run();
    const page = await f.listCommitteeAccessOverview(f.db, f.actor, {
      configuration: f.configuration,
      consoleGroupEmail: null,
      now,
    });
    assert.equal(page.items.find((r) => r.id === 'events')?.discord.holders, null);
    const lead = await f.create('limited-lead@example.invalid', 'Lead');
    await f.committees.assign({
      personId: lead.id,
      committeeId: 'events',
      role: 'lead',
      actorId: f.admin.id,
      operationId: 'lead-review',
    });
    const actor = await loadActor(f.db, lead.id);
    assert.ok(actor);
    await assert.rejects(
      f.listCommitteeAccessOverview(f.db, actor, {
        configuration: f.configuration,
        consoleGroupEmail: null,
        now,
      }),
      PermissionDenied,
    );
    f.db.raw.exec('DROP TRIGGER staff_admin_keep_last; DELETE FROM staff_administrators;');
    await assert.rejects(
      f.listCommitteeAccessOverview(f.db, f.actor, {
        configuration: f.configuration,
        consoleGroupEmail: null,
        now,
      }),
      PermissionDenied,
    );
  } finally {
    f.db.raw.close();
  }
});
void test('Google first-seen evidence survives a repeated complete check and resets after access is corrected', async () => {
  const f = await fixture();
  try {
    const first = await getGoogleGroupReview(f.db, f.actor, { ...f.query, groupEmail });
    assert.equal(
      first?.items.find((p) => p.personId === f.survivor.id)?.firstSeenAt,
      f.snapshot.observedAt,
    );
    const later = {
      ...f.snapshot,
      startedAt: '2026-10-14T12:01:00.000Z',
      observedAt: '2026-10-14T12:01:01.000Z',
    };
    assert.equal(
      await saveGoogleGroupSnapshot(f.db, later, {
        consoleGroupEmail: f.query.consoleGroupEmail,
        now: new Date('2026-10-14T12:01:05.000Z'),
        isCurrent: () => Promise.resolve(true),
      }),
      true,
    );
    const repeated = await getGoogleGroupReview(f.db, f.actor, {
      ...f.query,
      now: new Date('2026-10-14T12:01:05.000Z'),
      groupEmail,
    });
    assert.equal(
      repeated?.items.find((p) => p.personId === f.survivor.id)?.firstSeenAt,
      f.snapshot.observedAt,
    );
    const corrected = {
      ...f.snapshot,
      startedAt: '2026-10-14T12:02:00.000Z',
      observedAt: '2026-10-14T12:02:01.000Z',
      members: [{ id: 'expected-user', type: 'USER', role: 'MEMBER' }],
    };
    const save = async (snapshot: typeof f.snapshot) =>
      saveGoogleGroupSnapshot(f.db, snapshot, {
        consoleGroupEmail: f.query.consoleGroupEmail,
        now: new Date(snapshot.observedAt),
        isCurrent: () => Promise.resolve(true),
      });
    assert.equal(await save(corrected), true);
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT count(*) AS n FROM access_mismatch_observations WHERE person_id=? AND provider='google_workspace'",
        )
        .get(f.survivor.id)?.n,
      0,
    );
    const reintroduced = {
      ...f.snapshot,
      startedAt: '2026-10-14T12:03:00.000Z',
      observedAt: '2026-10-14T12:03:01.000Z',
    };
    assert.equal(await save(reintroduced), true);
    assert.equal(await save(f.snapshot), false, 'a stale snapshot cannot change first seen');
    const again = await getGoogleGroupReview(f.db, f.actor, {
      ...f.query,
      groupEmail,
      now: new Date(reintroduced.observedAt),
    });
    assert.equal(
      again?.items.find((p) => p.personId === f.survivor.id)?.firstSeenAt,
      reintroduced.observedAt,
    );
  } finally {
    f.db.raw.close();
  }
});
void test('Discord first-seen resets after correction, ignores unknown checks and clears on erasure', async () => {
  const f = await fixture();
  try {
    const observation = {
      personId: f.survivor.id,
      targetId: 'events',
      provider: 'discord' as const,
      identityId: '333333333333333333',
      identityEmail: null,
      resourceId: role,
      contextId: guild,
      generation: 1,
      expectedAccess: true,
    };
    const write = async (state: 'granted' | 'absent' | 'unknown', stamp: string) =>
      assert.equal(
        await recordAccessObservation(
          f.db,
          {
            ...observation,
            state,
            observedAt: stamp,
            expiresAt: new Date(Date.parse(stamp) + 300000).toISOString(),
          },
          new Date(stamp),
        ),
        true,
      );
    await write('unknown', '2026-10-14T12:01:00.000Z');
    assert.equal(
      f.db.raw
        .prepare(
          'SELECT first_seen_at AS first FROM access_mismatch_observations WHERE person_id=? AND provider=?',
        )
        .get(f.survivor.id, 'discord')?.first,
      now.toISOString(),
    );
    await write('granted', '2026-10-14T12:02:00.000Z');
    assert.equal(
      f.db.raw
        .prepare(
          'SELECT count(*) AS n FROM access_mismatch_observations WHERE person_id=? AND provider=?',
        )
        .get(f.survivor.id, 'discord')?.n,
      0,
    );
    await write('absent', '2026-10-14T12:03:00.000Z');
    assert.equal(
      f.db.raw
        .prepare(
          'SELECT first_seen_at AS first FROM access_mismatch_observations WHERE person_id=? AND provider=?',
        )
        .get(f.survivor.id, 'discord')?.first,
      '2026-10-14T12:03:00.000Z',
    );
    await f.people.deletePerson(f.survivor.id);
    assert.equal(
      f.db.raw
        .prepare('SELECT count(*) AS n FROM access_mismatch_observations WHERE person_id=?')
        .get(f.survivor.id)?.n,
      0,
    );
  } finally {
    f.db.raw.close();
  }
});
void test('committee Discord review uses shared-role entitlement and keeps pagination in committee scope', async () => {
  const f = await fixture();
  try {
    assert.equal(
      typeof f.listCommitteeDiscordReview,
      'function',
      'committee review needs bounded actual/expected rows',
    );
    f.db.raw.prepare("UPDATE committees SET discord_lead_role_id=? WHERE id='advocacy'").run(role);
    const assigned = await f.committees.assign({
      personId: f.extra.id,
      committeeId: 'advocacy',
      role: 'lead',
      actorId: f.admin.id,
      operationId: 'shared-entitlement',
    });
    assert.equal(assigned.kind, 'ok');
    const page = await f.listCommitteeDiscordReview(f.db, f.actor, {
      configuration: f.configuration,
      consoleGroupEmail: null,
      now,
      committeeId: 'events',
      limit: 1,
    });
    assert.equal(page.items.length, 1);
    assert.ok(page.items[0]);
    assert.equal(page.items[0].personId, f.survivor.id);
    assert.equal(page.items[0].expected, true);
    assert.equal(page.items[0].actual.state, 'absent');
    assert.equal(
      page.items.some((p) => p.personId === f.extra.id),
      false,
      'access expected through another committee must never appear unexpected',
    );
    assert.equal(page.items[0].firstSeenAt, now.toISOString());
    assert.equal(
      page.nextCursor,
      null,
      'the shared-role holder must be excluded across every page',
    );
  } finally {
    f.db.raw.close();
  }
});
