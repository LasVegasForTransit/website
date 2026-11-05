import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createHash } from 'node:crypto';
import { createWorkspaceConnector } from '../../src/connector';

export const config = {
  environment: 'preview' as const,
  customerId: 'C-lvbt',
  origin: 'https://workspace-preview.example.run.app',
  siteAudience: 'https://preview.lasvegasfortransit.org/api/workspace/v1',
  schedulerSubject: '222222222222222222222',
  serviceAccount: 'workspace-preview@lvbt-core.iam.gserviceaccount.com',
  delegatedAdmin: 'platform-admin@lasvegasfortransit.org',
  consoleGroupEmail: 'console-preview@lasvegasfortransit.org',
  productionConsoleGroupEmail: 'console-users@lasvegasfortransit.org',
  managedGroups: ['committee-preview@lasvegasfortransit.org'],
  productionGroups: ['committee@lasvegasfortransit.org'],
  previewUserIds: Array.from({ length: 50 }, (_, i) => `user-${i + 1}`),
};
const time = new Date('2026-11-04T20:00:00Z');
export const directory = 'https://admin.googleapis.com/admin/directory/v1';
export const user = {
  kind: 'admin#directory#user',
  id: 'user-1',
  customerId: 'C-lvbt',
  primaryEmail: 'human@lasvegasfortransit.org',
  name: { givenName: 'A', familyName: 'Human' },
  orgUnitPath: '/People',
  suspended: false,
  archived: false,
};
export async function fixture(
  options: {
    quota?: boolean;
    emptyQuota?: boolean;
    scan?: boolean;
    stale?: boolean;
    backoff?: boolean;
    renew?: boolean;
    deleted?: boolean;
    wrongIdentity?: boolean;
    expired?: boolean;
    count?: number;
    offset?: number;
    stopScan?: boolean;
    expiredCursor?: boolean;
    transientCursor?: boolean;
    idleGroups?: boolean;
    excludedGroupUser?: boolean;
  } = {},
) {
  const actions: Record<string, unknown>[] = [],
    urls: string[] = [];
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'fixture', alg: 'RS256', use: 'sig' };
  const scheduler = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
    .setIssuer('https://accounts.google.com')
    .setSubject(options.wrongIdentity ? '333333333333333333333' : config.schedulerSubject)
    .setAudience(config.origin)
    .setIssuedAt(time)
    .setExpirationTime(new Date(time.getTime() + (options.expired ? -1000 : 3600000)))
    .sign(privateKey);
  let claimed = false,
    granted = false;
  function portal(init?: RequestInit) {
    const a = JSON.parse(typeof init?.body === 'string' ? init.body : '') as Record<
      string,
      unknown
    >;
    actions.push(a);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture-site-id');
    if (a.action === 'channelValidate')
      return Response.json({
        valid: a.tokenHash === createHash('sha256').update('secret').digest('base64url'),
        retryAfterMs: options.backoff ? 120000 : 0,
      });
    if (a.action === 'channelRegister')
      return Response.json({ registered: options.renew === true });
    if (a.action === 'maintenance')
      return Response.json({
        events: options.renew ? ['add', 'update', 'delete', 'undelete'] : [],
        scan: scanClaim(),
        groupsDue: !options.idleGroups,
      });
    if (a.action === 'scanClaim') return Response.json(scanClaim());
    if (a.action === 'current') return Response.json({ current: !options.stale });
    if (a.action === 'claim') return claim();
    return Response.json({ current: true });
  }
  function scanClaim() {
    return options.scan
      ? {
          token: 'scan',
          pageToken: options.expiredCursor || options.transientCursor ? 'expired-cursor' : null,
          phase: options.deleted ? 'deleted' : 'active',
          offset: options.offset ?? 0,
        }
      : { kind: 'idle' };
  }
  function claim() {
    if (claimed || options.idleGroups) return Response.json({ kind: 'idle' });
    claimed = true;
    return Response.json({
      token: 'lease',
      plan: {
        kind: 'console',
        customerId: 'C-lvbt',
        userId: options.excludedGroupUser ? 'outside-preview' : 'user-1',
        email: user.primaryEmail,
        operationId: 'op',
        revision: '1',
        personId: 'person',
        groups: [{ resourceId: config.consoleGroupEmail, desired: true }],
      },
    });
  }
  function googleDirectory(url: string, init?: RequestInit) {
    if (url.includes('/orgunits?')) {
      assert.equal(new URL(url).searchParams.get('type'), 'all_including_parent');
      return Response.json({
        organizationUnits: [
          { orgUnitId: 'id:root', orgUnitPath: '/' },
          { orgUnitId: 'id:people', orgUnitPath: '/People' },
        ],
      });
    }
    if (url === `${directory}/users/user-1?projection=basic&viewType=admin_view`) {
      if (options.emptyQuota)
        return new Response(null, { status: 429, headers: { 'Retry-After': '90' } });
      if (options.quota)
        return Response.json(
          { error: { code: 429 } },
          { status: 429, headers: { 'Retry-After': '120' } },
        );
      return Response.json(user);
    }
    if (url.startsWith(`${directory}/users/watch?`)) {
      const channel = JSON.parse(typeof init?.body === 'string' ? init.body : '') as {
        id: string;
        expiration: string;
      };
      return Response.json({ ...channel, resourceId: 'watch-resource' });
    }
    if (url.startsWith(`${directory}/users?`)) return usersPage();
    return googleGroup(url, init);
  }
  function usersPage() {
    if (options.expiredCursor)
      return Response.json(
        {
          error: {
            code: 400,
            message: 'Invalid Input: pageToken',
            errors: [
              {
                reason: 'invalid',
                message: 'Invalid Input: pageToken',
                location: 'pageToken',
                locationType: 'parameter',
              },
            ],
          },
        },
        { status: 400 },
      );
    if (options.transientCursor)
      return Response.json({ error: { code: 503, message: 'Backend Error' } }, { status: 503 });
    return Response.json(
      options.deleted
        ? { users: [{ id: 'user-1', deletionTime: '2026-11-04T19:00:00Z' }] }
        : {
            users: Array.from({ length: options.count ?? 1 }, (_, i) => ({
              ...user,
              id: `user-${i + 1}`,
              primaryEmail: `person${i + 1}@lasvegasfortransit.org`,
            })),
            nextPageToken: 'next-page',
          },
    );
  }
  function googleGroup(url: string, init?: RequestInit) {
    if (url === `${directory}/groups/${encodeURIComponent(config.consoleGroupEmail)}`)
      return Response.json({ id: 'group-1', email: config.consoleGroupEmail });
    if (url.endsWith('/members/user-1'))
      return granted
        ? Response.json({ id: 'user-1', type: 'USER', role: 'MEMBER' })
        : Response.json(
            { error: { code: 404, errors: [{ reason: 'notFound' }] } },
            { status: 404 },
          );
    if (url.endsWith('/hasMember/user-1')) return Response.json({ isMember: granted });
    if (url.endsWith('/members') && init?.method === 'POST') {
      granted = true;
      return Response.json({ id: 'user-1', type: 'USER', role: 'MEMBER' });
    }
    throw new Error(`unexpected request ${url}`);
  }
  function route(input: Parameters<typeof fetch>[0], init?: RequestInit) {
    const url = input instanceof Request ? input.url : input.toString();
    urls.push(url);
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [jwk] });
    if (url.startsWith('http://metadata.google.internal/'))
      return url.includes('/identity?')
        ? new Response('fixture-site-id')
        : Response.json({ access_token: 'runtime', expires_in: 3600 });
    if (url.startsWith('https://iamcredentials.googleapis.com/'))
      return Response.json({ signedJwt: 'signed' });
    if (url === 'https://oauth2.googleapis.com/token')
      return Response.json({ access_token: 'delegated', expires_in: 3600 });
    if (url === config.siteAudience) return portal(init);
    return googleDirectory(url, init);
  }
  const fetcher: typeof fetch = (input, init) => Promise.resolve(route(input, init));
  let ticks = 0;
  const connector = createWorkspaceConnector(config, {
    fetch: fetcher,
    now: () => (options.stopScan ? new Date(time.getTime() + ticks++ * 1000) : time),
  });
  return { connector, actions, urls, scheduler };
}
export function notification(token = 'secret') {
  return new Request(`${config.origin}/notifications`, {
    method: 'POST',
    headers: {
      'X-Goog-Channel-ID': 'add.fixture',
      'X-Goog-Channel-Token': token,
      'X-Goog-Resource-ID': 'resource',
      'X-Goog-Resource-State': 'add',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...user, primaryEmail: 'forged@lasvegasfortransit.org' }),
  });
}
