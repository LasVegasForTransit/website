import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { Miniflare, Response as RuntimeResponse, convertV4MiniflareOptions } from 'miniflare';
import { applyMigrations } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { createSession } from '@lasvegasfortransit/platform-storage/auth';
export const ORIGIN = 'https://lasvegasfortransit.org';
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
function simulatorFor(
  root: string,
  data: string,
  tls: { httpsKey: string; httpsCert: string },
  providerCalls: string[],
) {
  return new Miniflare(
    convertV4MiniflareOptions({
      host: '127.0.0.1',
      port: 0,
      https: true,
      ...tls,
      name: 'lvbt-discord-browser-fixture',
      modules: true,
      scriptPath: join(root, '.wrangler/worker/index.js'),
      compatibilityDate: '2026-09-04',
      compatibilityFlags: ['nodejs_compat'],
      resourcePersistencePath: data,
      cf: false,
      telemetry: { enabled: false },
      bindings: {
        LVBT_SIGN_IN_SECRET: 'fixture-session-only',
        LVBT_LINK_SIGNING_SECRET: 'fixture-links-only',
        LVBT_DISCORD_APPLICATION_ID: '111111111111111111',
        LVBT_DISCORD_CLIENT_SECRET: 'fixture-client-only',
      },
      d1Databases: { PLATFORM_DB: 'discord-browser-fixture' },
      assets: {
        directory: join(root, 'dist'),
        binding: 'ASSETS',
        run_worker_first: true,
        routerConfig: { has_user_worker: true },
      },
      outboundService: async (request) => {
        providerCalls.push(request.url);
        if (request.url === 'https://discord.com/api/v10/oauth2/token') {
          assert.equal(request.method, 'POST');
          const form = new URLSearchParams(await request.text());
          assert.equal(form.get('grant_type'), 'authorization_code');
          assert.equal(form.get('redirect_uri'), `${ORIGIN}/account/discord/callback`);
          return new RuntimeResponse(
            JSON.stringify({
              access_token: 'fixture-access-only',
              refresh_token: 'fixture-refresh-only',
              token_type: 'Bearer',
              scope: 'identify',
              expires_in: 600,
            }),
            { headers: { 'Content-Type': 'application/json' } },
          );
        }
        assert.equal(request.url, 'https://discord.com/api/v10/users/@me');
        assert.equal(request.headers.get('Authorization'), 'Bearer fixture-access-only');
        return new RuntimeResponse(JSON.stringify(DISCORD_USER), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    }),
  );
}
export async function discordRuntime() {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const data = await mkdtemp(join(tmpdir(), 'lvbt-discord-browser-'));
  const tls = await certificate(data);
  const authorization = await authorizationServer(tls);
  const providerCalls: string[] = [];
  const simulator = simulatorFor(root, data, tls, providerCalls);
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
