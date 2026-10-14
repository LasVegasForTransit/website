import assert from 'node:assert/strict';
import test from 'node:test';
import {
  googleOverviewFixture,
  groupEmail,
  consoleGroupEmail,
  now,
} from './support/google-group-overview-fixture';

async function api() {
  const loaded = await import('../src/google-group-overview').catch(() => null);
  assert.ok(loaded, 'staff need an authorized stored group overview and mismatch review');
  return loaded;
}

void test('the overview separates missing, unexpected, unmatched and unconfirmed people', async () => {
  const { listGoogleGroupOverview, getGoogleGroupReview } = await api();
  const f = await googleOverviewFixture();
  const overview = await listGoogleGroupOverview(f.db, f.actor, f.query);
  const group = overview.items.find((row) => row.groupEmail === groupEmail);
  assert.ok(group);
  assert.equal(group.state, 'current');
  assert.equal(group.userCount, 2);
  assert.equal(group.expectedCount, 2);
  assert.equal(group.missingCount, 1);
  assert.equal(group.unexpectedCount, 1);
  assert.equal(group.unmatchedCount, 1);
  assert.equal(group.unconfirmedCount, 1);
  const review = await getGoogleGroupReview(f.db, f.actor, { ...f.query, groupEmail });
  assert.ok(review);
  assert.equal(review.items.length, 3);
  assert.equal(review.items.find((row) => row.personId === f.survivor.id)?.state, 'missing');
  assert.equal(review.items.find((row) => row.personId === f.extra.id)?.state, 'unexpected');
  assert.equal(review.items.find((row) => row.personId === f.unconfirmed.id)?.identityId, null);
  assert.doesNotMatch(JSON.stringify(review.items), /unmatched-user|nested-group/);
});

void test('a retained group reused by another committee counts only current assignments', async () => {
  const { listGoogleGroupOverview } = await api();
  const f = await googleOverviewFixture();
  f.db.raw
    .prepare(
      "INSERT INTO committee_account_mappings(committee_id,provider,external_id,recorded_at) VALUES('events','google_workspace',?,?)",
    )
    .run(groupEmail, now.toISOString());
  f.db.raw.prepare("UPDATE committees SET workspace_group_email=NULL WHERE id='events'").run();
  f.db.raw
    .prepare('UPDATE committees SET workspace_group_email=? WHERE id=?')
    .run(groupEmail, 'advocacy');
  await f.committees.assign({
    personId: f.survivor.id,
    committeeId: 'advocacy',
    role: 'member',
    actorId: f.admin.id,
    operationId: 'second-committee',
  });
  await f.committees.assign({
    personId: f.extra.id,
    committeeId: 'advocacy',
    role: 'member',
    actorId: f.admin.id,
    operationId: 'extra-second-committee',
  });
  let group = (await listGoogleGroupOverview(f.db, f.actor, f.query)).items.find(
    (row) => row.groupEmail === groupEmail,
  );
  assert.equal(group?.expectedCount, 2);
  assert.equal(group.unexpectedCount, 0);
  f.db.raw
    .prepare('UPDATE committees SET workspace_group_email=NULL WHERE id IN (?,?)')
    .run('events', 'advocacy');
  group = (await listGoogleGroupOverview(f.db, f.actor, f.query)).items.find(
    (row) => row.groupEmail === groupEmail,
  );
  assert.equal(group?.expectedCount, 0);
  assert.equal(group.unexpectedCount, 1);
  assert.equal(
    group.committees.every((committee) => !committee.current),
    true,
  );
});

void test('expired, failed, unconfigured and other-customer checks cannot report current counts', async () => {
  const { listGoogleGroupOverview } = await api();
  const f = await googleOverviewFixture();
  const cases = [
    { ...f.query, now: new Date('2026-10-14T12:06:00.000Z'), want: 'stale' },
    {
      ...f.query,
      configuration: { ...f.configuration, configured: false },
      want: 'not_configured',
    },
    {
      ...f.query,
      configuration: { ...f.configuration, resourceIds: [consoleGroupEmail] },
      want: 'not_configured',
    },
    { ...f.query, configuration: { ...f.configuration, contextId: 'Cother' }, want: 'not_checked' },
  ];
  for (const item of cases) {
    const group = (await listGoogleGroupOverview(f.db, f.actor, item)).items.find(
      (row) => row.groupEmail === groupEmail,
    );
    assert.equal(group?.state, item.want);
    assert.equal(group.userCount, null);
    assert.equal(group.missingCount, null);
  }
  f.db.raw
    .prepare(
      "INSERT INTO google_group_check_failures(context_id,group_email,failure,started_at) VALUES('Cpreview',?,'rate_limited','2026-10-14T12:00:02.000Z')",
    )
    .run(groupEmail);
  const failed = (await listGoogleGroupOverview(f.db, f.actor, f.query)).items.find(
    (row) => row.groupEmail === groupEmail,
  );
  assert.equal(failed?.state, 'unavailable');
  assert.equal(failed.lastUserCount, 2);
});

void test('domain-wide populations and corrupted partial caches cannot become a false all-clear', async () => {
  const { listGoogleGroupOverview } = await api();
  const f = await googleOverviewFixture();
  f.db.raw
    .prepare(
      "UPDATE google_group_inventory_members SET member_type='CUSTOMER' WHERE member_id='unmatched-user'",
    )
    .run();
  const partial = (await listGoogleGroupOverview(f.db, f.actor, f.query)).items[0];
  assert.equal(partial?.state, 'needs_review');
  assert.equal(partial.userCount, null);
  assert.equal(partial.missingCount, null);
  assert.equal(
    (await listGoogleGroupOverview(f.db, f.actor, { ...f.query, problemsOnly: true }))
      .totalProblems,
    1,
  );
});

void test('the console count remains separate from group pagination and warns at the review threshold', async () => {
  const { listGoogleGroupOverview } = await api();
  const f = await googleOverviewFixture();
  assert.equal(
    await f.save({
      ...f.snapshot,
      groupEmail: consoleGroupEmail,
      members: Array.from({ length: 45 }, (_, index) => ({
        id: `staff-${index}`,
        type: 'USER',
        role: 'MEMBER',
      })),
    }),
    true,
  );
  const result = await listGoogleGroupOverview(f.db, f.actor, f.query);
  assert.equal(result.console?.userCount, 45);
  assert.equal(result.console.needsSeatReview, true);
  assert.equal(
    result.items.some((group) => group.groupEmail === consoleGroupEmail),
    false,
  );
});

void test('erased member contact details cannot escape through stored group data', async () => {
  const { getGoogleGroupReview } = await api();
  const f = await googleOverviewFixture();
  await f.people.deletePerson(f.extra.id);
  const result = await getGoogleGroupReview(f.db, f.actor, { ...f.query, groupEmail });
  assert.ok(result);
  assert.equal(result.summary.unmatchedCount, 2);
  assert.doesNotMatch(JSON.stringify(result), /Extra Member|extra@example.invalid/);
});

void test('a stale actor and revocation immediately before the sensitive query disclose no group data', async () => {
  const { listGoogleGroupOverview } = await api();
  const f = await googleOverviewFixture();
  f.db.raw
    .prepare(
      'INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES(?,?,?)',
    )
    .run(f.survivor.id, 'fixture', now.toISOString());
  const revoked = {
    ...f.db,
    prepare: (sql: string) => {
      if (sql.includes('google_group_inventory'))
        f.db.raw.prepare('DELETE FROM staff_administrators WHERE person_id=?').run(f.admin.id);
      return f.db.prepare(sql);
    },
  };
  await assert.rejects(listGoogleGroupOverview(revoked, f.actor, f.query), {
    permission: 'staff_admin.manage',
  });
});

void test('review pagination preserves its group and current global problem counts', async () => {
  const { listGoogleGroupOverview, getGoogleGroupReview } = await api();
  const f = await googleOverviewFixture();
  f.db.raw
    .prepare(
      "UPDATE committees SET workspace_group_email='z-preview@lasvegasfortransit.org' WHERE id='advocacy'",
    )
    .run();
  const first = await listGoogleGroupOverview(f.db, f.actor, { ...f.query, limit: 1 });
  assert.equal(first.totalGroups, 2);
  assert.equal(first.totalProblems, 2);
  assert.ok(first.nextCursor);
  const next = await listGoogleGroupOverview(f.db, f.actor, {
    ...f.query,
    limit: 1,
    cursor: first.nextCursor,
  });
  assert.equal(next.items.length, 1);
  assert.equal(next.nextCursor, null);
  assert.notEqual(next.items[0]?.groupEmail, first.items[0]?.groupEmail);
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await getGoogleGroupReview(f.db, f.actor, {
      ...f.query,
      groupEmail,
      limit: 1,
      cursor,
    });
    assert.ok(page);
    seen.push(...page.items.map((row) => row.personId));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(new Set(seen).size, 3);
  const review = await getGoogleGroupReview(f.db, f.actor, { ...f.query, groupEmail, limit: 1 });
  assert.ok(review?.nextCursor);
  await assert.rejects(
    getGoogleGroupReview(f.db, f.actor, {
      ...f.query,
      groupEmail: 'z-preview@lasvegasfortransit.org',
      cursor: review.nextCursor,
    }),
  );
});

void test('unverified or ambiguous identities are unconfirmed people and unmatched holders', async () => {
  const { getGoogleGroupReview } = await api();
  const f = await googleOverviewFixture();
  await f.people.linkIdentity(f.extra.id, {
    platform: 'google_workspace',
    externalId: 'second-user',
    linkMethod: 'staff_confirmed',
  });
  f.db.raw
    .prepare(
      "UPDATE identities SET link_method='created_by_platform' WHERE external_id='expected-user'",
    )
    .run();
  const review = await getGoogleGroupReview(f.db, f.actor, { ...f.query, groupEmail });
  assert.equal(review?.summary.unmatchedCount, 2);
  assert.equal(review.summary.unconfirmedCount, 2);
  assert.equal(review.summary.missingCount, 0);
  assert.equal(review.summary.unexpectedCount, 0);
  assert.equal(
    review.items.some((person) => person.personId === f.extra.id),
    false,
  );
});

void test('a verified empty result differs from an unregistered or future check', async () => {
  const { listGoogleGroupOverview, getGoogleGroupReview } = await api();
  const f = await googleOverviewFixture();
  f.db.raw
    .prepare('DELETE FROM committee_assignments WHERE person_id IN (?,?)')
    .run(f.survivor.id, f.unconfirmed.id);
  assert.equal(
    await f.save({
      ...f.snapshot,
      startedAt: '2026-10-14T12:00:02.000Z',
      observedAt: '2026-10-14T12:00:03.000Z',
      members: [],
    }),
    true,
  );
  let group = (await listGoogleGroupOverview(f.db, f.actor, f.query)).items[0];
  assert.equal(group?.state, 'current');
  assert.equal(group.userCount, 0);
  assert.equal((await listGoogleGroupOverview(f.db, f.actor, f.query)).totalProblems, 0);
  group = (
    await listGoogleGroupOverview(f.db, f.actor, {
      ...f.query,
      now: new Date('2026-10-14T11:00:00.000Z'),
    })
  ).items[0];
  assert.equal(group?.state, 'not_checked');
  assert.equal(group.userCount, null);
  assert.equal(
    await getGoogleGroupReview(f.db, f.actor, {
      ...f.query,
      groupEmail: 'not-registered@lasvegasfortransit.org',
    }),
    null,
  );
  f.db.raw.prepare("UPDATE committees SET workspace_group_email=NULL WHERE id='events'").run();
  assert.equal((await listGoogleGroupOverview(f.db, f.actor, f.query)).totalGroups, 0);
});

void test('a committee lead cannot read group-wide counts or member differences', async () => {
  const { listGoogleGroupOverview, getGoogleGroupReview } = await api();
  const f = await googleOverviewFixture();
  await f.committees.assign({
    personId: f.survivor.id,
    committeeId: 'events',
    role: 'lead',
    actorId: f.admin.id,
    operationId: 'lead-test',
  });
  const actor = { ...f.actor, personId: f.survivor.id };
  await assert.rejects(listGoogleGroupOverview(f.db, actor, f.query), {
    permission: 'staff_admin.manage',
  });
  await assert.rejects(getGoogleGroupReview(f.db, actor, { ...f.query, groupEmail }), {
    permission: 'staff_admin.manage',
  });
});

void test('long registered group addresses remain usable through native review pagination', async () => {
  const { getGoogleGroupReview } = await api();
  const f = await googleOverviewFixture();
  const longGroup = `${'a'.repeat(120)}@lasvegasfortransit.org`;
  f.db.raw
    .prepare('UPDATE committees SET workspace_group_email=? WHERE id=?')
    .run(longGroup, 'events');
  assert.equal(await f.save({ ...f.snapshot, groupEmail: longGroup }), true);
  const query = {
    ...f.query,
    configuration: { ...f.configuration, resourceIds: [longGroup] },
    groupEmail: longGroup,
    limit: 1,
  };
  const first = await getGoogleGroupReview(f.db, f.actor, query);
  assert.ok(first?.nextCursor);
  const second = await getGoogleGroupReview(f.db, f.actor, { ...query, cursor: first.nextCursor });
  assert.equal(second?.items.length, 1);
  assert.notEqual(first.items[0]?.personId, second.items[0]?.personId);
});
