import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFixture } from './support/merge-fixture';
import { useHistoricalMembershipSchema } from './support/legacy-membership';
import { everyStoredText, applyMigrations } from './support/db';
import { runMaintenance } from '../src/retention';

const groupEmail = 'preview-events@lasvegasfortransit.org';
const consoleGroupEmail = 'preview-console@lasvegasfortransit.org';
const stamp = new Date('2026-10-14T12:00:00.000Z');
const now = new Date('2026-10-14T12:00:05.000Z');
function snapshot(count = 2) {
  return {
    customerId: 'Cpreview',
    groupId: 'google-events',
    groupEmail,
    startedAt: stamp.toISOString(),
    observedAt: new Date(stamp.getTime() + 1000).toISOString(),
    members: Array.from({ length: count }, (_, index) => ({
      id: `google-user-${index}`,
      type: 'USER' as const,
      role: 'MEMBER' as const,
      email: `private-provider-${index}@example.invalid`,
      status: 'ACTIVE',
    })),
    userCount: count,
  };
}
async function fixture() {
  const api = await import('../src/google-group-snapshots').catch(() => null);
  assert.ok(api, 'access overview needs stored complete Google group checks');
  const f = await mergeFixture();
  f.db.raw
    .prepare('UPDATE committees SET workspace_group_email=? WHERE id=?')
    .run(groupEmail, 'events');
  return {
    ...f,
    ...api,
    options: { consoleGroupEmail, now, isCurrent: () => Promise.resolve(true) },
  };
}

void test('complete snapshots store account keys and roles without retaining provider contact profiles', async () => {
  const f = await fixture();
  assert.equal(await f.saveGoogleGroupSnapshot(f.db, snapshot(), f.options), true);
  assert.equal(
    f.db.raw.prepare('SELECT count(*) AS n FROM google_group_inventory_members').get()?.n,
    2,
  );
  assert.equal(
    f.db.raw.prepare('SELECT user_count FROM google_group_inventory').get()?.user_count,
    2,
  );
  assert.doesNotMatch(everyStoredText(f.db), /private-provider-|ACTIVE/);
  assert.equal(await f.saveGoogleGroupSnapshot(f.db, snapshot(), f.options), true);
  assert.equal(
    f.db.raw.prepare('SELECT count(*) AS n FROM google_group_inventory_members').get()?.n,
    2,
  );
});

void test('older or conflicting overlapping collectors cannot replace a newer complete check', async () => {
  const f = await fixture();
  assert.equal(await f.saveGoogleGroupSnapshot(f.db, snapshot(), f.options), true);
  assert.equal(
    await f.saveGoogleGroupSnapshot(
      f.db,
      { ...snapshot(1), startedAt: '2026-10-14T11:59:59.000Z' },
      f.options,
    ),
    false,
  );
  assert.equal(await f.saveGoogleGroupSnapshot(f.db, snapshot(1), f.options), false);
  assert.equal(
    f.db.raw.prepare('SELECT count(*) AS n FROM google_group_inventory_members').get()?.n,
    2,
  );
  assert.equal(
    await f.saveGoogleGroupSnapshot(
      f.db,
      {
        ...snapshot(1),
        startedAt: '2026-10-14T12:00:02.000Z',
        observedAt: '2026-10-14T12:00:03.000Z',
      },
      f.options,
    ),
    true,
  );
  assert.equal(
    f.db.raw.prepare('SELECT user_count FROM google_group_inventory').get()?.user_count,
    1,
  );
});

void test('failed replacement rolls back metadata and every member change together', async () => {
  const f = await fixture();
  assert.equal(await f.saveGoogleGroupSnapshot(f.db, snapshot(), f.options), true);
  const broken = {
    ...f.db,
    batch: (statements: Parameters<typeof f.db.batch>[0]) =>
      f.db.batch([
        ...statements,
        f.db
          .prepare(
            "INSERT INTO google_group_inventory_members(context_id,group_email,member_id,member_type,member_role) VALUES('Cpreview',?,'broken','INVALID','MEMBER')",
          )
          .bind(groupEmail),
      ]),
  };
  await assert.rejects(
    f.saveGoogleGroupSnapshot(
      broken,
      {
        ...snapshot(1),
        startedAt: '2026-10-14T12:00:02.000Z',
        observedAt: '2026-10-14T12:00:03.000Z',
      },
      f.options,
    ),
  );
  assert.equal(
    f.db.raw.prepare('SELECT user_count FROM google_group_inventory').get()?.user_count,
    2,
  );
  assert.equal(
    f.db.raw.prepare('SELECT count(*) AS n FROM google_group_inventory_members').get()?.n,
    2,
  );
});

void test('storing ten thousand accounts stays within free invocation query and binding budgets', async () => {
  const f = await fixture();
  let queries = 0;
  let largestBindings = 0;
  const measured = {
    ...f.db,
    prepare: (sql: string) => {
      queries += 1;
      const statement = f.db.prepare(sql);
      const bind = statement.bind.bind(statement);
      statement.bind = (...values) => {
        largestBindings = Math.max(largestBindings, values.length);
        return bind(...values);
      };
      return statement;
    },
  };
  assert.equal(await f.saveGoogleGroupSnapshot(measured, snapshot(10000), f.options), true);
  assert.ok(queries < 50);
  assert.ok(largestBindings <= 100);
  assert.equal(
    f.db.raw.prepare('SELECT count(*) AS n FROM google_group_inventory_members').get()?.n,
    10000,
  );
});

void test('unregistered groups, paused collection, malformed identities and future checks save no inventory', async () => {
  const f = await fixture();
  assert.equal(
    await f.saveGoogleGroupSnapshot(
      f.db,
      { ...snapshot(), groupEmail: 'unregistered@lasvegasfortransit.org' },
      f.options,
    ),
    false,
  );
  assert.equal(
    await f.saveGoogleGroupSnapshot(f.db, snapshot(), {
      ...f.options,
      isCurrent: () => Promise.resolve(false),
    }),
    false,
  );
  for (const input of [
    { ...snapshot(), startedAt: '2026-10-14T12:00:04.000Z' },
    { ...snapshot(), observedAt: '2026-10-15T12:00:00.000Z' },
    { ...snapshot(), members: [{ id: '', type: 'USER', role: 'MEMBER' }] },
    { ...snapshot(), members: [{ id: 'bad', type: ['CUSTOMER'], role: 'MEMBER' }] },
    { ...snapshot(), members: [snapshot().members[0], snapshot().members[0]] },
  ])
    await assert.rejects(f.saveGoogleGroupSnapshot(f.db, input, f.options));
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM google_group_inventory').get()?.n, 0);
});

void test('domain-wide membership keeps the exact people count unavailable', async () => {
  const f = await fixture();
  assert.equal(
    await f.saveGoogleGroupSnapshot(
      f.db,
      {
        ...snapshot(),
        userCount: 0,
        members: [{ id: 'Ctenant', type: 'CUSTOMER', role: 'MEMBER' }],
      },
      f.options,
    ),
    true,
  );
  assert.equal(
    f.db.raw.prepare('SELECT user_count FROM google_group_inventory').get()?.user_count,
    null,
  );
});

void test('stored group checks expire within the approved five-minute confirmation window', async () => {
  const f = await fixture();
  assert.equal(await f.saveGoogleGroupSnapshot(f.db, snapshot(), f.options), true);
  assert.equal(
    f.db.raw.prepare('SELECT expires_at FROM google_group_inventory').get()?.expires_at,
    '2026-10-14T12:05:01.000Z',
  );
});

void test('failure records preserve the last complete inventory and cannot regress a newer check', async () => {
  const f = await fixture();
  assert.equal(await f.saveGoogleGroupSnapshot(f.db, snapshot(), f.options), true);
  const failure = {
    customerId: 'Cpreview',
    groupEmail,
    failure: 'rate_limited' as const,
    startedAt: '2026-10-14T12:00:02.000Z',
  };
  assert.equal(await f.recordGoogleGroupCheckFailure(f.db, failure, f.options), true);
  assert.equal(
    f.db.raw.prepare('SELECT user_count FROM google_group_inventory').get()?.user_count,
    2,
  );
  assert.equal(
    f.db.raw.prepare('SELECT failure FROM google_group_check_failures').get()?.failure,
    'rate_limited',
  );
  assert.equal(
    await f.recordGoogleGroupCheckFailure(
      f.db,
      { ...failure, startedAt: '2026-10-14T11:59:59.000Z' },
      f.options,
    ),
    false,
  );
  assert.equal(
    await f.saveGoogleGroupSnapshot(
      f.db,
      {
        ...snapshot(1),
        startedAt: '2026-10-14T12:00:03.000Z',
        observedAt: '2026-10-14T12:00:04.000Z',
      },
      f.options,
    ),
    true,
  );
  assert.equal(
    f.db.raw.prepare('SELECT count(*) AS n FROM google_group_check_failures').get()?.n,
    0,
  );
});

void test('the configured console group is registered without a committee and expired caches are pruned', async () => {
  const f = await fixture();
  assert.equal(await f.googleGroupRegistered(f.db, consoleGroupEmail, consoleGroupEmail), true);
  assert.equal(
    await f.saveGoogleGroupSnapshot(
      f.db,
      { ...snapshot(), groupEmail: consoleGroupEmail },
      f.options,
    ),
    true,
  );
  assert.equal(await f.pruneGoogleGroupSnapshots(f.db, new Date('2026-10-15T12:00:02.000Z')), 1);
  assert.equal(
    f.db.raw.prepare('SELECT count(*) AS n FROM google_group_inventory_members').get()?.n,
    0,
  );
});

void test('registration removed immediately before the transaction prevents publication', async () => {
  const f = await fixture();
  const removed = {
    ...f.db,
    batch: (statements: Parameters<typeof f.db.batch>[0]) => {
      f.db.raw.prepare('UPDATE committees SET workspace_group_email=NULL WHERE id=?').run('events');
      f.db.raw
        .prepare(
          "DELETE FROM committee_account_mappings WHERE provider='google_workspace' AND external_id=?",
        )
        .run(groupEmail);
      return f.db.batch(statements);
    },
  };
  assert.equal(await f.saveGoogleGroupSnapshot(removed, snapshot(), f.options), false);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM google_group_inventory').get()?.n, 0);
});

void test('upgrading the canonical schema preserves membership while adding empty caches', async () => {
  const f = await mergeFixture();
  useHistoricalMembershipSchema(f.db, '0031_discord_disconnect.sql');
  const before = f.db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n;
  applyMigrations(f.db.raw);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, before);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM google_group_inventory').get()?.n, 0);
});

void test('ordinary maintenance removes expired inventories without changing erasure result accounting', async () => {
  const f = await fixture();
  assert.equal(await f.saveGoogleGroupSnapshot(f.db, snapshot(), f.options), true);
  const result = await runMaintenance(f.db, { now: new Date('2026-10-15T12:00:02.000Z') });
  assert.equal(result.profilesErased, 0);
  assert.equal(result.profilesRemoved, 0);
  assert.equal(
    f.db.raw.prepare('SELECT count(*) AS n FROM google_group_inventory_members').get()?.n,
    0,
  );
});
