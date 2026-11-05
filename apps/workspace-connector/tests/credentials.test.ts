import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ManagedGoogleCredentials } from '../src/credentials';

void test('Google credentials use managed signing and a fixed restricted delegated administrator', async () => {
  const requests: string[] = [];
  const route = (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    requests.push(url);
    if (
      url ===
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'
    ) {
      assert.equal(new Headers(init?.headers).get('Metadata-Flavor'), 'Google');
      return Response.json({
        access_token: 'fixture-runtime-access',
        expires_in: 3600,
        token_type: 'Bearer',
      });
    }
    if (
      url ===
      'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/workspace-preview@lvbt-core.iam.gserviceaccount.com:signJwt'
    ) {
      assert.equal(
        new Headers(init?.headers).get('Authorization'),
        'Bearer fixture-runtime-access',
      );
      const request = JSON.parse(typeof init?.body === 'string' ? init.body : '') as {
        payload: string;
      };
      const payload = JSON.parse(request.payload) as Record<string, unknown>;
      assert.equal(payload.sub, 'platform-admin@lasvegasfortransit.org');
      assert.equal(payload.aud, 'https://oauth2.googleapis.com/token');
      assert.equal(payload.scope, 'https://www.googleapis.com/auth/admin.directory.user.readonly');
      return Response.json({ signedJwt: 'fixture.managed.signature' });
    }
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
    assert.equal(body.get('assertion'), 'fixture.managed.signature');
    assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    return Response.json({
      access_token: 'fixture-delegated-access',
      token_type: 'Bearer',
      expires_in: 3600,
    });
  };
  const fetcher: typeof fetch = (input, init) => Promise.resolve(route(input, init));
  const credentials = new ManagedGoogleCredentials(
    {
      serviceAccount: 'workspace-preview@lvbt-core.iam.gserviceaccount.com',
      delegatedAdmin: 'platform-admin@lasvegasfortransit.org',
      siteAudience: 'https://preview.lasvegasfortransit.org/api/workspace/v1',
    },
    { fetch: fetcher, now: () => new Date('2026-11-04T20:00:00Z') },
  );
  assert.equal(
    await credentials.getToken(['https://www.googleapis.com/auth/admin.directory.user.readonly']),
    'fixture-delegated-access',
  );
  assert.equal(requests.length, 3);
});

void test('the credential source rejects broader scopes and arbitrary ID-token audiences', async () => {
  let called = false;
  const credentials = new ManagedGoogleCredentials(
    {
      serviceAccount: 'workspace-preview@lvbt-core.iam.gserviceaccount.com',
      delegatedAdmin: 'platform-admin@lasvegasfortransit.org',
      siteAudience: 'https://preview.lasvegasfortransit.org/api/workspace/v1',
    },
    {
      fetch: () => {
        called = true;
        return Promise.reject(new Error('must not fetch'));
      },
    },
  );
  await assert.rejects(credentials.getToken(['https://www.googleapis.com/auth/gmail.readonly']));
  await assert.rejects(credentials.idToken('https://attacker.example'));
  assert.equal(called, false);
});

void test('expired metadata credentials never reach the signing endpoint', async () => {
  const requests: string[] = [];
  const source = new ManagedGoogleCredentials(
    {
      serviceAccount: 'workspace-preview@lvbt-core.iam.gserviceaccount.com',
      delegatedAdmin: 'platform-admin@lasvegasfortransit.org',
      siteAudience: 'https://preview.lasvegasfortransit.org/api/workspace/v1',
    },
    {
      fetch: (input) => {
        requests.push(input instanceof Request ? input.url : input.toString());
        return Promise.resolve(Response.json({ access_token: 'expired', expires_in: 0 }));
      },
    },
  );
  await assert.rejects(
    source.getToken(['https://www.googleapis.com/auth/admin.directory.user.readonly']),
  );
  assert.equal(requests.length, 1);
});
void test('credential redirects cannot move a delegated assertion to an arbitrary URL', async () => {
  const source = new ManagedGoogleCredentials(
    {
      serviceAccount: 'workspace-preview@lvbt-core.iam.gserviceaccount.com',
      delegatedAdmin: 'platform-admin@lasvegasfortransit.org',
      siteAudience: 'https://preview.lasvegasfortransit.org/api/workspace/v1',
    },
    {
      fetch: (_input, init) => {
        assert.equal(init?.redirect, 'manual');
        return Promise.resolve(
          new Response(null, { status: 302, headers: { Location: 'https://attacker.example' } }),
        );
      },
    },
  );
  await assert.rejects(
    source.getToken(['https://www.googleapis.com/auth/admin.directory.user.readonly']),
  );
});
