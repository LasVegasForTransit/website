import assert from 'node:assert/strict';
import test from 'node:test';
import { GoogleGroups, GoogleGroupsFailure } from '../src/google-groups';
import { configuration, groupEmail, groupId } from './support/google-directory';
import { groupList, listedUser } from './support/google-group-list';

const current = { groupEmail, isCurrent: () => Promise.resolve(true) };
async function api() {
  const loaded = await import('../src/google-group-inventory').catch(() => null);
  assert.ok(loaded, 'full group membership is required to find unmatched holders and count staff');
  return loaded;
}
function client(fixture: ReturnType<typeof groupList>) {
  return new GoogleGroups(configuration, fixture.tokens, { fetch: fixture.fetch });
}

void test('full membership includes people beyond the first page and unmatched accounts', async () => {
  const { readGoogleGroupInventory } = await api();
  const pages = Array.from({ length: 6 }, (_, page) => ({
    kind: 'admin#directory#members',
    etag: 'page-fixture',
    members: Array.from({ length: page === 5 ? 1 : 200 }, (_, index) =>
      listedUser(`user-${page * 200 + index}`),
    ),
    ...(page === 5 ? {} : { nextPageToken: `opaque+/=?${page + 1}` }),
  }));
  const fixture = groupList(pages);
  const result = await readGoogleGroupInventory(client(fixture), current);
  assert.equal(result.userCount, 1001);
  assert.equal(result.members.length, 1001);
  assert.equal(result.members.at(-1)?.id, 'user-1000');
  assert.equal(result.groupId, groupId);
  assert.equal(result.customerId, 'Cfixture');
  assert.equal(fixture.calls.filter((url) => url.pathname.endsWith('/members')).length, 6);
});

void test('indirect users count once while nested groups and owner roles remain visible', async () => {
  const { readGoogleGroupInventory } = await api();
  const owner = listedUser('owner', 'OWNER');
  const nested = { ...listedUser('nested'), type: 'GROUP' };
  const fixture = groupList([
    { members: [owner, nested], nextPageToken: 'opaque+/=?1' },
    { members: [owner, listedUser('indirect', 'MANAGER')] },
  ]);
  const result = await readGoogleGroupInventory(client(fixture), current);
  assert.equal(result.userCount, 2);
  assert.equal(result.members.length, 3);
  assert.equal(result.members.find((member) => member.id === 'owner')?.role, 'OWNER');
  assert.equal(result.members.find((member) => member.id === 'nested')?.type, 'GROUP');
});

void test('a genuinely empty group returns zero after an authoritative complete response', async () => {
  const { readGoogleGroupInventory } = await api();
  const result = await readGoogleGroupInventory(client(groupList([{}])), current);
  assert.equal(result.userCount, 0);
  assert.deepEqual(result.members, []);
  assert.ok(Date.parse(result.observedAt) >= Date.parse(result.startedAt));
});

void test('domain-wide or unresolved external membership cannot become an exact people count', async () => {
  const { readGoogleGroupInventory } = await api();
  for (const type of ['CUSTOMER', 'EXTERNAL']) {
    const fixture = groupList([
      { members: [listedUser('known'), { id: 'Ctenant', type, role: 'MEMBER' }] },
    ]);
    const result = await readGoogleGroupInventory(client(fixture), current);
    assert.equal(result.userCount, null);
    assert.equal(result.members.length, 2);
  }
});

void test('malformed members and cursor responses are rejected instead of becoming a complete empty group', async () => {
  const { readGoogleGroupInventory } = await api();
  for (const payload of [
    { kind: undefined },
    { kind: 'unrelated-resource' },
    { members: null },
    { members: {} },
    { members: [listedUser('valid'), { ...listedUser('broken'), id: '' }] },
    { members: [{ ...listedUser('broken'), type: 'UNKNOWN' }] },
    { members: [{ ...listedUser('broken'), role: 'ADMIN' }] },
    { members: [{ ...listedUser('broken'), email: 'bad email' }] },
    { members: [], nextPageToken: '' },
    { members: [], nextPageToken: 42 },
    { members: [], nextPageToken: 'bad\nvalue' },
    { members: Array.from({ length: 201 }, (_, index) => listedUser(`user-${index}`)) },
  ])
    await assert.rejects(readGoogleGroupInventory(client(groupList([payload])), current), {
      kind: 'invalid_response',
    });
});

void test('pagination cycles and conflicting duplicate accounts cannot return a completed inventory', async () => {
  const { readGoogleGroupInventory } = await api();
  for (const pages of [
    [
      { members: [], nextPageToken: 'opaque+/=?1' },
      { members: [], nextPageToken: 'opaque+/=?1' },
    ],
    [
      { members: [listedUser('same')], nextPageToken: 'opaque+/=?1' },
      { members: [listedUser('same', 'OWNER')] },
    ],
  ])
    await assert.rejects(readGoogleGroupInventory(client(groupList(pages)), current), {
      kind: 'invalid_response',
    });
});

void test('rate limits after a successful page discard the partial inventory and preserve the retry delay', async () => {
  const { readGoogleGroupInventory } = await api();
  const fixture = groupList([{ members: [listedUser('first')], nextPageToken: 'opaque+/=?1' }, {}]);
  fixture.state.failPage = 1;
  await assert.rejects(readGoogleGroupInventory(client(fixture), current), {
    kind: 'rate_limited',
    retryAfterMs: 30000,
  });
});

void test('replaced groups and renamed aliases cannot mix membership from different resources', async () => {
  const { readGoogleGroupInventory } = await api();
  const fixture = groupList([{ members: [listedUser('first')], nextPageToken: 'opaque+/=?1' }, {}]);
  const replaced = new GoogleGroups(configuration, fixture.tokens, {
    fetch: (input, init) => {
      if (fixture.calls.length === 2) fixture.state.groupId = 'replacement-group';
      return fixture.fetch(input, init);
    },
  });
  await assert.rejects(readGoogleGroupInventory(replaced, current), { kind: 'invalid_response' });
  fixture.state.groupEmail = 'renamed@lasvegasfortransit.org';
  await assert.rejects(readGoogleGroupInventory(client(fixture), current), {
    kind: 'invalid_response',
  });
});

void test('revoked authorization before or during reads never returns the group inventory', async () => {
  const { readGoogleGroupInventory } = await api();
  for (const revokeAfter of [0, 1, 2]) {
    const fixture = groupList([{ members: [listedUser('private')] }]);
    await assert.rejects(
      readGoogleGroupInventory(client(fixture), {
        groupEmail,
        isCurrent: () => Promise.resolve(fixture.calls.length < revokeAfter),
      }),
      { kind: 'stale_operation' },
    );
    assert.ok(fixture.calls.length <= revokeAfter);
  }
});

void test('preview cannot inventory production or unregistered groups before any provider read', async () => {
  const { readGoogleGroupInventory } = await api();
  const fixture = groupList();
  for (const email of ['advocacy@lasvegasfortransit.org', 'unregistered@lasvegasfortransit.org'])
    await assert.rejects(
      readGoogleGroupInventory(client(fixture), { ...current, groupEmail: email }),
      {
        kind: 'not_configured',
      },
    );
  assert.equal(fixture.calls.length, 0);
});

void test('a final page that exceeds the inventory deadline cannot produce a fresh result', async () => {
  const { readGoogleGroupInventory } = await api();
  const fixture = groupList([{ members: [listedUser('last')] }]);
  let stamp = Date.now();
  const started = stamp;
  const clocked = new GoogleGroups(configuration, fixture.tokens, {
    fetch: fixture.fetch,
    now: () => stamp,
  });
  await assert.rejects(
    readGoogleGroupInventory(
      clocked,
      {
        groupEmail,
        isCurrent: () => {
          if (fixture.calls.length === 2) stamp = started + 30001;
          return Promise.resolve(true);
        },
      },
      { now: () => stamp },
    ),
    { kind: 'provider_unavailable' },
  );
});

void test('overlong inventories stop after the bounded page budget without returning partial counts', async () => {
  const { readGoogleGroupInventory } = await api();
  const fixture = groupList(
    Array.from({ length: 51 }, (_, page) => ({
      members: [],
      nextPageToken: `opaque+/=?${page + 1}`,
    })),
  );
  await assert.rejects(readGoogleGroupInventory(client(fixture), current), {
    kind: 'invalid_response',
  });
  assert.equal(fixture.calls.filter((url) => url.pathname.endsWith('/members')).length, 50);
});

void test('resuming a page requires its original stable group identity and a valid cursor', async () => {
  await api();
  const fixture = groupList();
  for (const extra of [
    { pageToken: 'opaque+/=?1' },
    { pageToken: '', expectedGroupId: groupId },
    { pageToken: 'bad\nvalue', expectedGroupId: groupId },
    { expectedGroupId: 'invalid/group' },
    { deadline: Infinity },
  ])
    await assert.rejects(client(fixture).listMembers({ ...current, ...extra }), {
      kind: 'not_configured',
    });
  assert.equal(fixture.calls.length, 0);
});

void test('caller mutation during authorization cannot redirect a validated page to production', async () => {
  const fixture = groupList([{ members: [listedUser('safe')] }]);
  const input = {
    groupEmail,
    isCurrent: () => {
      input.groupEmail = 'advocacy@lasvegasfortransit.org';
      return Promise.resolve(true);
    },
  };
  const result = await client(fixture).listMembers(input);
  assert.equal(result.groupEmail, groupEmail);
  assert.equal(result.members[0]?.id, 'safe');
  assert.equal(
    fixture.calls.some((url) =>
      decodeURIComponent(url.pathname).endsWith('/advocacy@lasvegasfortransit.org'),
    ),
    false,
  );
});

void test('a stalled authorization check cannot outlive the page deadline', async () => {
  const fixture = groupList();
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    client(fixture)
      .listMembers({
        groupEmail,
        deadline: Date.now() + 10,
        isCurrent: () => new Promise<boolean>(() => undefined),
      })
      .then(
        () => 'unexpected inventory',
        (error: unknown) => {
          assert.ok(error instanceof GoogleGroupsFailure);
          return error.kind;
        },
      ),
    new Promise<string>((resolve) => {
      watchdog = setTimeout(() => resolve('unbounded check'), 100);
    }),
  ]);
  clearTimeout(watchdog);
  assert.equal(result, 'provider_unavailable');
  assert.equal(fixture.calls.length, 0);
});
