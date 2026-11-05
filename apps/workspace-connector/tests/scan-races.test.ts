import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backend } from './support/backend';
import { config, directory, user } from './support/runtime';
import { Directory } from '../src/directory';
import { ManagedGoogleCredentials } from '../src/credentials';
import { Site } from '../src/site';

void test('a delayed active scan snapshot cannot overwrite a newer suspension in the real D1 API', async () => {
  const f = await backend();
  let now = new Date('2026-11-04T20:00:00Z');
  const readAt = now.toISOString();
  const fetcher: typeof fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.startsWith('http://metadata.google.internal/'))
      return Response.json({ access_token: 'runtime', expires_in: 3600 });
    if (url.startsWith('https://iamcredentials.googleapis.com/'))
      return Response.json({ signedJwt: 'signed' });
    if (url === 'https://oauth2.googleapis.com/token')
      return Response.json({ access_token: 'delegated', expires_in: 3600 });
    if (url.startsWith(`${directory}/users?`)) return Response.json({ users: [user] });
    if (url.includes('/orgunits?')) {
      f.suspend();
      now = new Date(now.getTime() + 1000);
      await f.action('enroll', {
        account: {
          customerId: config.customerId,
          userId: user.id,
          email: user.primaryEmail,
          givenName: 'A',
          familyName: 'Human',
          orgUnitId: 'ou-people',
          suspended: true,
          archived: false,
          deleted: false,
          observedAt: now.toISOString(),
        },
      });
      f.suspend();
      now = new Date(now.getTime() + 1000);
      return Response.json({
        organizationUnits: [{ orgUnitId: 'ou-people', orgUnitPath: '/People' }],
      });
    }
    throw new Error(`Unexpected fixture request ${url}`);
  };
  const credentials = new ManagedGoogleCredentials(config, { fetch: fetcher, now: () => now });
  const source = new Directory(config, credentials, {
    fetch: fetcher,
    now: () => now,
    site: new Site(config.siteAudience, credentials, fetcher),
  });
  try {
    const page = await source.page('active', null);
    // The returned snapshot must carry its conservative provider read time.
    const old = await source.observation(
      page.users[0] as Record<string, unknown>,
      false,
      page.observedAt,
    );
    await f.action('enroll', { account: old });
    assert.equal(old.observedAt, readAt);
    assert.equal(
      (await f.db.prepare('SELECT state FROM workspace_enrollments').first())?.state,
      'inactive',
    );
  } finally {
    await f.close();
  }
});

void test('a delayed deleted-user page cannot overwrite a newer restored account', async () => {
  const f = await backend();
  let now = new Date('2026-11-04T20:00:00Z');
  const fetcher: typeof fetch = (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.startsWith('http://metadata.google.internal/'))
      return Promise.resolve(Response.json({ access_token: 'runtime', expires_in: 3600 }));
    if (url.startsWith('https://iamcredentials.googleapis.com/'))
      return Promise.resolve(Response.json({ signedJwt: 'signed' }));
    if (url === 'https://oauth2.googleapis.com/token')
      return Promise.resolve(Response.json({ access_token: 'delegated', expires_in: 3600 }));
    if (url.startsWith(`${directory}/users?`))
      return Promise.resolve(
        Response.json({ users: [{ id: user.id, deletionTime: '2026-11-04T19:00:00Z' }] }),
      );
    throw new Error(`Unexpected fixture request ${url}`);
  };
  const credentials = new ManagedGoogleCredentials(config, { fetch: fetcher, now: () => now });
  const source = new Directory(config, credentials, {
    fetch: fetcher,
    now: () => now,
    site: new Site(config.siteAudience, credentials, fetcher),
  });
  try {
    const page = await source.page('deleted', null);
    f.suspend();
    now = new Date(now.getTime() + 1000);
    await f.action('enroll', {
      account: {
        customerId: config.customerId,
        userId: user.id,
        email: user.primaryEmail,
        givenName: 'A',
        familyName: 'Human',
        orgUnitId: 'ou-people',
        suspended: false,
        archived: false,
        deleted: false,
        observedAt: now.toISOString(),
      },
    });
    f.suspend();
    now = new Date(now.getTime() + 1000);
    const old = await source.observation(
      page.users[0] as Record<string, unknown>,
      true,
      page.observedAt,
    );
    await f.action('enroll', { account: old });
    assert.equal(
      (await f.db.prepare('SELECT state FROM workspace_enrollments').first())?.state,
      'active',
    );
    assert.equal(old.observedAt, '2026-11-04T20:00:00.000Z');
  } finally {
    await f.close();
  }
});
