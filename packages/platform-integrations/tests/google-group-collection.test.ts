import assert from 'node:assert/strict';
import test from 'node:test';
import { GoogleGroups } from '../src/google-groups';
import { groupList, listedUser } from './support/google-group-list';
import { configuration, groupEmail, groupId } from './support/google-directory';
import { memoryDb, everyStoredText } from '@lasvegasfortransit/platform-storage/test-db';
import { saveGoogleGroupSnapshot } from '@lasvegasfortransit/platform-storage/google-group-snapshots';

async function api() {
  const loaded = await import('../src/google-group-collection').catch(() => null);
  assert.ok(loaded, 'the complete group reader must publish stored checks for staff');
  return loaded;
}
function database() {
  const db = memoryDb();
  db.raw
    .prepare('UPDATE committees SET workspace_group_email=? WHERE id=?')
    .run(groupEmail, 'advocacy');
  return db;
}
const options = { groupEmail, consoleGroupEmail: null, isCurrent: () => Promise.resolve(true) };

void test('collection publishes complete multi-page results without copying provider email', async () => {
  const { collectGoogleGroupSnapshot } = await api();
  const db = database();
  const fixture = groupList([
    {
      members: Array.from({ length: 200 }, (_, index) => listedUser(`user-${index}`)),
      nextPageToken: 'opaque+/=?1',
    },
    { members: [listedUser('last-user')] },
  ]);
  const result = await collectGoogleGroupSnapshot(
    db,
    new GoogleGroups(configuration, fixture.tokens, { fetch: fixture.fetch }),
    options,
  );
  assert.equal(result.kind, 'saved');
  assert.equal(
    db.raw.prepare('SELECT user_count FROM google_group_inventory').get()?.user_count,
    201,
  );
  assert.doesNotMatch(everyStoredText(db), /user-0@lasvegasfortransit\.org/);
});

void test('a failed later page preserves the last complete check without saving partial holders', async () => {
  const { collectGoogleGroupSnapshot } = await api();
  const db = database();
  const started = Date.now() - 10000;
  assert.equal(
    await saveGoogleGroupSnapshot(
      db,
      {
        customerId: configuration.customerId,
        groupId,
        groupEmail,
        startedAt: new Date(started).toISOString(),
        observedAt: new Date(started + 1000).toISOString(),
        members: [{ id: 'last-complete', type: 'USER', role: 'MEMBER' }],
      },
      { ...options, now: new Date() },
    ),
    true,
  );
  const fixture = groupList([
    { members: [listedUser('partial-first')], nextPageToken: 'opaque+/=?1' },
    {},
  ]);
  fixture.state.failPage = 1;
  const result = await collectGoogleGroupSnapshot(
    db,
    new GoogleGroups(configuration, fixture.tokens, { fetch: fixture.fetch }),
    options,
  );
  assert.equal(result.kind, 'failed');
  assert.equal(
    db.raw.prepare('SELECT user_count FROM google_group_inventory').get()?.user_count,
    1,
  );
  assert.equal(
    db.raw.prepare('SELECT failure FROM google_group_check_failures').get()?.failure,
    'rate_limited',
  );
  assert.doesNotMatch(everyStoredText(db), /partial-first/);
});

void test('unregistered or paused collection makes no provider read and publishes no check', async () => {
  const { collectGoogleGroupSnapshot } = await api();
  const db = database();
  const fixture = groupList();
  const client = new GoogleGroups(configuration, fixture.tokens, { fetch: fixture.fetch });
  assert.equal(
    (
      await collectGoogleGroupSnapshot(db, client, {
        ...options,
        isCurrent: () => Promise.resolve(false),
      })
    ).kind,
    'stale',
  );
  db.raw.prepare('UPDATE committees SET workspace_group_email=NULL WHERE id=?').run('advocacy');
  assert.equal((await collectGoogleGroupSnapshot(db, client, options)).kind, 'stale');
  assert.equal(fixture.calls.length, 0);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM google_group_inventory').get()?.n, 0);
});
