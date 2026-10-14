import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import {
  Miniflare,
  Response as RuntimeResponse,
  convertV4MiniflareOptions,
  type V4FetchHandler,
} from 'miniflare';
import { applyMigrations } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { createSession } from '@lasvegasfortransit/platform-storage/auth';
export const ORIGIN = 'https://preview.lasvegasfortransit.org';
export const DISCORD_ROLES = {
  member: '333333333333333333',
  firstCommittee: '444444444444444444',
  secondCommittee: '888888888888888888',
  unmanaged: '666666666666666666',
};
interface Scenario {
  joined: boolean;
  pending: boolean;
  failJoin: boolean;
  failRoleWrites: boolean;
  roles: Set<string>;
}
export const DISCORD_USER = {
  id: '222222222222222222',
  username: 'fixture.member',
  global_name: 'Fixture Discord',
  avatar: null,
};
async function certificate(data: string) {
  const key = join(data, 'key.pem'),
    cert = join(data, 'cert.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      '/CN=lasvegasfortransit.org',
    ],
    { stdio: 'ignore' },
  );
  return { httpsKey: await readFile(key, 'utf8'), httpsCert: await readFile(cert, 'utf8') };
}
async function migrate(simulator: Miniflare, data: string) {
  const db = await simulator.getD1Database('PLATFORM_DB');
  await db.prepare('SELECT 1 AS ready').first();
  const files = await readdir(data, { recursive: true });
  const file = files.find((name) => name.includes('d1') && name.endsWith('.sqlite'));
  assert.ok(file);
  const raw = new DatabaseSync(join(data, file));
  try {
    applyMigrations(raw);
  } finally {
    raw.close();
  }
  return db;
}
async function authorizationServer(tls: { httpsKey: string; httpsCert: string }) {
  const authorizations: URL[] = [];
  const server = createServer({ key: tls.httpsKey, cert: tls.httpsCert }, (request, response) => {
    const url = new URL(request.url ?? '/', 'https://discord.com');
    if (url.pathname !== '/oauth2/authorize') {
      response.writeHead(404);
      response.end();
      return;
    }
    authorizations.push(url);
    const state = url.searchParams.get('state') ?? '';
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(
      `<html><body><h1>Fixture Discord authorization</h1><a href="${ORIGIN}/account/discord/callback?state=${encodeURIComponent(state)}&amp;code=fixture-code">Authorize fixture account</a></body></html>`,
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    port: (server.address() as AddressInfo).port,
    authorizations,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
function updateRoles(request: Parameters<V4FetchHandler>[0], scenario: Scenario): RuntimeResponse {
  if (scenario.failRoleWrites) return json({ message: 'fixture unavailable' }, 503);
  const role = new URL(request.url).pathname.split('/').at(-1);
  assert.ok(role);
  assert.notEqual(role, DISCORD_ROLES.unmanaged, 'the integration never writes an unmanaged role');
  assert.equal(scenario.pending, false, 'screening must finish before a managed-role grant');
  if (request.method === 'PUT') scenario.roles.add(role);
  else {
    assert.equal(request.method, 'DELETE');
    scenario.roles.delete(role);
  }
  return new RuntimeResponse(null, { status: 204 });
}
function json(value: unknown, status = 200): RuntimeResponse {
  return new RuntimeResponse(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
async function joinResponse(
  request: Parameters<V4FetchHandler>[0],
  scenario: Scenario,
  member: () => unknown,
): Promise<RuntimeResponse> {
  assert.deepEqual(await request.json(), { access_token: 'fixture-access-only' });
  if (scenario.failJoin) return json({ message: 'fixture unavailable' }, 503);
  if (scenario.joined) return new RuntimeResponse(null, { status: 204 });
  scenario.joined = true;
  return json(member(), 201);
}
async function simulatorFor(
  root: string,
  data: string,
  tls: { httpsKey: string; httpsCert: string },
  fixture: { providerCalls: string[]; scenario: Scenario },
) {
  const { providerCalls, scenario } = fixture;
  const memberPath = `/api/v10/guilds/111111111111111111/members/${DISCORD_USER.id}`;
  const member = () => ({
    user: DISCORD_USER,
    roles: [...scenario.roles],
    pending: scenario.pending,
    nick: null,
  });
  const provider: V4FetchHandler = async (request) => {
    providerCalls.push(request.url);
    const url = new URL(request.url);
    assert.equal(url.origin, 'https://discord.com');
    if (url.pathname === '/api/v10/oauth2/token') {
      assert.equal(request.method, 'POST');
      const form = new URLSearchParams(await request.text());
      assert.equal(form.get('grant_type'), 'authorization_code');
      assert.equal(form.get('redirect_uri'), `${ORIGIN}/account/discord/callback`);
      return json({
        access_token: 'fixture-access-only',
        refresh_token: 'fixture-refresh-only',
        token_type: 'Bearer',
        scope: 'identify guilds.join',
        expires_in: 600,
      });
    }
    if (url.pathname === '/api/v10/users/@me') {
      assert.equal(request.headers.get('Authorization'), 'Bearer fixture-access-only');
      return json(DISCORD_USER);
    }
    assert.equal(request.headers.get('Authorization'), 'Bot fixture-bot-only');
    if (url.pathname === '/api/v10/guilds/111111111111111111/members') {
      assert.equal(request.method, 'GET');
      assert.equal(url.searchParams.get('limit'), '1000');
      return json(scenario.joined ? [member()] : []);
    }
    if (url.pathname === memberPath) {
      if (request.method === 'PUT') {
        return await joinResponse(request, scenario, member);
      }
      assert.equal(request.method, 'GET');
      return scenario.joined ? json(member()) : json({ code: 10007 }, 404);
    }
    assert.ok(url.pathname.startsWith(`${memberPath}/roles/`));
    return updateRoles(request, scenario);
  };
  return new Miniflare(
    convertV4MiniflareOptions({
      host: '127.0.0.1',
      port: 0,
      https: true,
      ...tls,
      resourcePersistencePath: data,
      telemetry: { enabled: false },
      workers: [
        {
          name: 'lvbt-discord-browser-fixture',
          modules: true,
          script: await readFile(join(root, '.wrangler/worker/index.js'), 'utf8'),
          compatibilityDate: '2026-09-04',
          compatibilityFlags: ['nodejs_compat'],
          cf: false,
          bindings: {
            LVBT_SIGN_IN_SECRET: 'fixture-session-only',
            LVBT_LINK_SIGNING_SECRET: 'fixture-links-only',
            LVBT_DISCORD_APPLICATION_ID: '555555555555555555',
            LVBT_DISCORD_CLIENT_SECRET: 'fixture-client-only',
            LVBT_DEPLOYMENT_ENV: 'preview',
          },
          serviceBindings: { LVBT_DISCORD_JOBS: 'lvbt-discord-jobs-fixture' },
          d1Databases: { PLATFORM_DB: 'discord-browser-fixture' },
          assets: {
            directory: join(root, 'dist'),
            binding: 'ASSETS',
            run_worker_first: true,
            routerConfig: { has_user_worker: true },
          },
          outboundService: provider,
        },
        {
          name: 'lvbt-discord-jobs-fixture',
          modules: true,
          script: await readFile(join(root, '../jobs/dist/index.js'), 'utf8'),
          compatibilityDate: '2026-09-04',
          compatibilityFlags: ['nodejs_compat'],
          cf: false,
          bindings: {
            LVBT_DEPLOYMENT_ENV: 'preview',
            LVBT_DISCORD_SYNC_ENABLED: 'true',
            LVBT_DISCORD_APPLICATION_ID: '555555555555555555',
            LVBT_DISCORD_GUILD_ID: '111111111111111111',
            LVBT_DISCORD_PRODUCTION_GUILD_ID: '999999999999999999',
            LVBT_DISCORD_MEMBER_ROLE_ID: DISCORD_ROLES.member,
            LVBT_DISCORD_BOT_TOKEN: 'fixture-bot-only',
          },
          d1Databases: { PLATFORM_DB: 'discord-browser-fixture' },
          outboundService: provider,
        },
      ],
    }),
  );
}
export async function discordRuntime() {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const data = await mkdtemp(join(tmpdir(), 'lvbt-discord-browser-'));
  const tls = await certificate(data);
  const authorization = await authorizationServer(tls);
  const providerCalls: string[] = [];
  const scenario: Scenario = {
    joined: false,
    pending: false,
    failJoin: false,
    failRoleWrites: false,
    roles: new Set([DISCORD_ROLES.unmanaged]),
  };
  const simulator = await simulatorFor(root, data, tls, { providerCalls, scenario });
  try {
    const db = await migrate(simulator, data),
      people = new PersonService(db);
    const { person } = await people.upsertFromSource({
      source: 'join_form',
      fields: { email: 'browser-member@example.invalid', given_name: 'LVBT Member' },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    });
    const stamp = new Date().toISOString();
    for (const [committee, role] of [
      ['civic-tech', DISCORD_ROLES.firstCommittee],
      ['events', DISCORD_ROLES.secondCommittee],
    ]) {
      assert.ok(committee && role);
      await db
        .prepare('UPDATE committees SET discord_role_id=?,updated_at=? WHERE id=?')
        .bind(role, stamp, committee)
        .run();
      await db
        .prepare(
          "INSERT INTO committee_assignments(id,person_id,committee_id,role,started_at,assigned_by,updated_at) VALUES(?,?,?,'member',?,?,?)",
        )
        .bind(`fixture-${committee}`, person.id, committee, stamp, person.id, stamp)
        .run();
      await db
        .prepare('INSERT INTO reconcile_generations(person_id,target_id,generation) VALUES(?,?,1)')
        .bind(person.id, committee)
        .run();
    }
    const jobs = await simulator.getWorker('lvbt-discord-jobs-fixture');
    const session = await createSession(
      { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-session-only' },
      person.id,
      'member',
    );
    return {
      root,
      simulator,
      db,
      people,
      person,
      session,
      providerCalls,
      scenario,
      jobs,
      authorization,
      port: (await simulator.ready).port,
      dispose: async () => {
        await simulator.dispose();
        await authorization.close();
        await rm(data, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await simulator.dispose();
    await authorization.close();
    await rm(data, { recursive: true, force: true });
    throw error;
  }
}
