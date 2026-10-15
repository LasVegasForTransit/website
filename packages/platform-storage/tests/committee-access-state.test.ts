import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, guild, role } from './support/committee-access-fixture';
import { now } from './support/google-group-overview-fixture';
import { recordAccessObservation } from '../src/access-observations';
void test('fresh unlinked Discord holders are counted separately and never become removals', async () => {
  const f = await fixture();
  try {
    f.db.raw
      .prepare(
        'INSERT INTO discord_role_reviews(guild_id,discord_user_id,managed_role_ids,first_seen_at,last_seen_at,last_seen_scan_id) VALUES(?,?,?,?,?,?)',
      )
      .run(
        guild,
        '777777777777777777',
        JSON.stringify([role]),
        now.toISOString(),
        now.toISOString(),
        'scan',
      );
    const page = await f.listCommitteeAccessOverview(f.db, f.actor, {
      configuration: f.configuration,
      consoleGroupEmail: null,
      now,
    });
    const events = page.items.find((c) => c.id === 'events');
    assert.ok(events);
    assert.equal(events.discord.holders, 2);
    assert.equal(events.discord.unmatched, 1);
    assert.equal(events.discord.unexpected, 1);
    const detail = await f.listCommitteeDiscordReview(f.db, f.actor, {
      configuration: f.configuration,
      consoleGroupEmail: null,
      now,
      committeeId: 'events',
    });
    assert.equal(detail.items.length, 2);
    assert.equal(
      detail.items.some((p) => p.personId === '777777777777777777'),
      false,
    );
  } finally {
    f.db.raw.close();
  }
});
void test('a pre-migration check cannot invent an earliest mismatch date', async () => {
  const f = await fixture();
  try {
    f.db.raw.prepare("DELETE FROM access_mismatch_observations WHERE provider='discord'").run();
    const page = await f.listCommitteeAccessOverview(f.db, f.actor, {
      configuration: f.configuration,
      consoleGroupEmail: null,
      now,
    });
    assert.equal(page.items.find((c) => c.id === 'events')?.discord.firstSeenAt, null);
  } finally {
    f.db.raw.close();
  }
});
void test('the review starts with mapped committees and the complete list remains available', async () => {
  const f = await fixture();
  try {
    const query = { configuration: f.configuration, consoleGroupEmail: null, now };
    const review = await f.listCommitteeAccessOverview(f.db, f.actor, query);
    assert.equal(
      review.items.some((c) => c.id === 'advocacy'),
      false,
    );
    const all = await f.listCommitteeAccessOverview(f.db, f.actor, {
      ...query,
      includeUnmapped: true,
    });
    assert.equal(
      all.items.some((c) => c.id === 'advocacy'),
      true,
    );
    const direct = await f.listCommitteeAccessOverview(f.db, f.actor, {
      ...query,
      committeeId: 'advocacy',
    });
    assert.equal(direct.items[0]?.id, 'advocacy');
  } finally {
    f.db.raw.close();
  }
});
void test('a newer unknown shared-role check suppresses an older confirmed holder', async () => {
  const f = await fixture();
  try {
    f.db.raw.prepare("UPDATE committees SET discord_lead_role_id=? WHERE id='advocacy'").run(role);
    const assignment = await f.committees.assign({
      personId: f.extra.id,
      committeeId: 'advocacy',
      role: 'lead',
      actorId: f.admin.id,
      operationId: 'shared-unknown-lead',
    });
    assert.equal(assignment.kind, 'ok');
    assert.equal(
      (
        await f.committees.endAssignment(
          assignment.value.id,
          'stepped_back',
          f.admin.id,
          'end-shared-unknown-lead',
        )
      ).kind,
      'ok',
    );
    const later = new Date(now.getTime() + 1000);
    assert.equal(
      await recordAccessObservation(
        f.db,
        {
          personId: f.extra.id,
          targetId: 'committee_lead:advocacy',
          provider: 'discord',
          identityId: '444444444444444444',
          identityEmail: null,
          resourceId: role,
          contextId: guild,
          generation: 2,
          expectedAccess: false,
          state: 'unknown',
          failure: 'provider_unavailable',
          observedAt: later.toISOString(),
          expiresAt: new Date(later.getTime() + 300000).toISOString(),
        },
        later,
      ),
      true,
    );
    const query = {
      configuration: f.configuration,
      consoleGroupEmail: null,
      now: later,
      committeeId: 'events',
    };
    const overview = await f.listCommitteeAccessOverview(f.db, f.actor, query);
    const committee = overview.items[0];
    assert.ok(committee);
    assert.equal(committee.discord.holders, 0);
    assert.equal(committee.discord.unexpected, 0);
    const review = await f.listCommitteeDiscordReview(f.db, f.actor, query);
    assert.equal(
      review.items.some((p) => p.personId === f.extra.id),
      false,
      'unknown current access cannot offer a false removal',
    );
  } finally {
    f.db.raw.close();
  }
});
