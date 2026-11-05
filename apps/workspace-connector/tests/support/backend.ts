import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { applyMigrations } from '@lasvegasfortransit/platform-storage/test-db';
import { workspaceConnectorRequest } from '@lasvegasfortransit/platform-integrations/workspace-connector-api';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createWorkspaceConnector } from '../../src/connector';
import { config as previewConfig, directory, notification, user } from './runtime';
import { tokenHash } from '../../src/maintenance';

export async function backend(options: { production?: boolean } = {}) {
  const data = await mkdtemp(join(tmpdir(), 'workspace-backend-'));
  const simulator = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("fixture")}}',
      compatibilityDate: '2026-09-04',
      resourcePersistencePath: data,
      d1Databases: { PLATFORM_DB: 'workspace-backend' },
      telemetry: { enabled: false },
      cf: false,
    }),
  );
  try {
    const db = await simulator.getD1Database('PLATFORM_DB');
    await db.prepare('SELECT 1').all();
    const files = await readdir(data, { recursive: true });
    const file = files.find(
      (f) =>
        f.includes('d1') &&
        f.endsWith('.sqlite') &&
        !basename(f).startsWith('._') &&
        basename(f) !== 'metadata.sqlite',
    );
    assert.ok(file);
    const raw = new DatabaseSync(join(data, file));
    try {
      applyMigrations(raw);
    } finally {
      raw.close();
    }
    return {
      ...(await transport(db, options)),
      db,
      async close() {
        await simulator.dispose();
        await rm(data, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await simulator.dispose();
    await rm(data, { recursive: true, force: true });
    throw error;
  }
}
async function transport(
  db: Awaited<ReturnType<Miniflare['getD1Database']>>,
  options: { production?: boolean },
) {
  const config = options.production
    ? {
        ...previewConfig,
        environment: 'production' as const,
        consoleGroupEmail: previewConfig.productionConsoleGroupEmail,
        managedGroups: previewConfig.productionGroups,
      }
    : previewConfig;
  let now = new Date('2026-11-04T20:00:00Z'),
    suspended = false,
    granted = false;
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'backend', alg: 'RS256', use: 'sig' };
  const subject = '111111111111111111111';
  async function token(audience: string, sub = subject) {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'backend' })
      .setIssuer('https://accounts.google.com')
      .setSubject(sub)
      .setAudience(audience)
      .setIssuedAt(now)
      .setExpirationTime(new Date(now.getTime() + 3600000))
      .sign(privateKey);
  }
  const env = {
    PLATFORM_DB: db,
    LVBT_WORKSPACE_ONBOARDING_ENABLED: 'true',
    LVBT_WORKSPACE_CONNECTOR_SUBJECT: subject,
    LVBT_WORKSPACE_CONNECTOR_AUDIENCE: config.siteAudience,
    LVBT_WORKSPACE_ONBOARDING_CONFIG: JSON.stringify({
      ...config,
      humanOrgUnitIds: ['ou-people'],
      includedUserIds: [],
      excludedUserIds: [],
    }),
  };
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [jwk] });
    if (url.startsWith('http://metadata.google.internal/'))
      return url.includes('/identity?')
        ? new Response(await token(config.siteAudience))
        : Response.json({ access_token: 'runtime', expires_in: 3600 });
    if (url.startsWith('https://iamcredentials.googleapis.com/'))
      return Response.json({ signedJwt: 'signed' });
    if (url === 'https://oauth2.googleapis.com/token')
      return Response.json({ access_token: 'delegated', expires_in: 3600 });
    if (url === config.siteAudience)
      return workspaceConnectorRequest(env, new Request(url, init), {
        fetch: fetcher,
        now: () => now,
      });
    if (url === `${directory}/users/user-1?projection=basic&viewType=admin_view`)
      return Response.json({ ...user, suspended });
    if (url.includes('/orgunits?'))
      return Response.json({
        organizationUnits: [{ orgUnitId: 'ou-people', orgUnitPath: '/People' }],
      });
    return group(url, init);
  };
  function group(url: string, init?: RequestInit) {
    if (url === `${directory}/groups/${encodeURIComponent(config.consoleGroupEmail)}`)
      return Response.json({ id: 'group-console', email: config.consoleGroupEmail });
    if (url.endsWith('/members/user-1')) {
      if (init?.method === 'DELETE') {
        granted = false;
        return new Response(null, { status: 204 });
      }
      return granted
        ? Response.json({ id: 'user-1', type: 'USER', role: 'MEMBER' })
        : Response.json(
            { error: { code: 404, errors: [{ reason: 'notFound' }] } },
            { status: 404 },
          );
    }
    if (url.endsWith('/hasMember/user-1')) return Response.json({ isMember: granted });
    if (url.endsWith('/members') && init?.method === 'POST') {
      granted = true;
      return Response.json({ id: 'user-1', type: 'USER', role: 'MEMBER' });
    }
    throw new Error(`Unexpected fixture request ${url}`);
  }
  const connector = createWorkspaceConnector(config, { fetch: fetcher, now: () => now });
  async function action(action: string, values: object) {
    const result = await workspaceConnectorRequest(
      env,
      new Request(config.siteAudience, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await token(config.siteAudience)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, ...values }),
      }),
      { fetch: fetcher, now: () => now },
    );
    assert.equal(result.status, 200, await result.clone().text());
    return result;
  }
  await action('channelRegister', {
    id: 'add.fixture',
    event: 'add',
    tokenHash: tokenHash('secret'),
    expiresAt: new Date(now.getTime() + 3600000).toISOString(),
  });
  await action('channelConfirm', {
    id: 'add.fixture',
    resourceId: 'resource',
    expiresAt: new Date(now.getTime() + 3600000).toISOString(),
  });
  return {
    calls,
    action,
    granted: () => granted,
    suspend() {
      suspended = true;
      now = new Date(now.getTime() + 1000);
    },
    notify: () => connector.fetch(notification()),
    run: async () =>
      connector.fetch(
        new Request(`${config.origin}/run`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await token(config.origin, config.schedulerSubject)}`,
          },
        }),
      ),
  };
}
