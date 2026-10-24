import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare, Response as RuntimeResponse, convertV4MiniflareOptions } from 'miniflare';
import { applyMigrations } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { createSession, requestCode } from '@lasvegasfortransit/platform-storage/auth';

export const ACCOUNT_ORIGIN = 'https://preview.lasvegasfortransit.org';
export interface AccountCodeEmail {
  to: string[];
  subject: string;
  tags: { name: string; value: string }[];
}
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
      '/CN=preview.lasvegasfortransit.org',
    ],
    { stdio: 'ignore' },
  );
  return { httpsKey: await readFile(key, 'utf8'), httpsCert: await readFile(cert, 'utf8') };
}
async function migrate(simulator: Miniflare, data: string) {
  const db = await simulator.getD1Database('PLATFORM_DB');
  await db.prepare('SELECT 1').first();
  const file = (await readdir(data, { recursive: true })).find(
    (name) => name.includes('d1') && name.endsWith('.sqlite'),
  );
  assert.ok(file);
  const raw = new DatabaseSync(join(data, file));
  try {
    applyMigrations(raw);
  } finally {
    raw.close();
  }
  return db;
}
/** One compiled website Worker, private synthetic members, and intercepted code email only. */
export async function accountDataRuntime() {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const data = await mkdtemp(join(tmpdir(), 'lvbt-account-data-'));
  const emails: AccountCodeEmail[] = [];
  const tls = await certificate(data);
  const simulator = new Miniflare(
    convertV4MiniflareOptions({
      host: '127.0.0.1',
      port: 0,
      https: true,
      ...tls,
      modules: true,
      script: await readFile(join(root, '.wrangler/worker/index.js'), 'utf8'),
      compatibilityDate: '2026-09-04',
      compatibilityFlags: ['nodejs_compat'],
      resourcePersistencePath: data,
      cf: false,
      telemetry: { enabled: false },
      bindings: {
        LVBT_SIGN_IN_SECRET: 'account-data-fixture-only',
        LVBT_RESEND_API_KEY: 'account-email-fixture-only',
        LVBT_DEPLOYMENT_ENV: 'preview',
      },
      d1Databases: { PLATFORM_DB: 'account-data-fixture' },
      assets: {
        directory: join(root, 'dist'),
        binding: 'ASSETS',
        run_worker_first: true,
        routerConfig: { has_user_worker: true },
      },
      outboundService: async (request) => {
        assert.equal(
          request.url,
          'https://api.resend.com/emails',
          'account acceptance must not contact a live provider',
        );
        assert.equal(request.method, 'POST');
        emails.push((await request.json()) as AccountCodeEmail);
        return new RuntimeResponse(JSON.stringify({ id: 'isolated-code-message' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    }),
  );
  try {
    const db = await migrate(simulator, data),
      people = new PersonService(db);
    const { person } = await people.upsertFromSource({
      source: 'join_form',
      fields: { email: 'account-rider@example.invalid', given_name: 'Account Rider' },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    });
    const { person: other } = await people.upsertFromSource({
      source: 'staff',
      fields: { email: 'private-other@example.invalid' },
    });
    await people.linkIdentity(person.id, {
      platform: 'google_workspace',
      externalId: 'account-google-fixture',
      externalEmail: 'account-volunteer@example.invalid',
      linkMethod: 'self_linked',
    });
    const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'account-data-fixture-only' };
    const session = await createSession(env, person.id, 'member');
    const secondSession = await createSession(env, person.id, 'member');
    const signIn = await requestCode(env, {
      email: person.email ?? '',
      personId: person.id,
      purpose: 'sign_in',
      callerAddress: 'fixture-sign-in',
    });
    assert.equal(signIn.kind, 'issued');
    return {
      root,
      tls: { key: tls.httpsKey, cert: tls.httpsCert },
      data,
      simulator,
      db,
      person,
      other,
      session,
      secondSession,
      signInCode: signIn.issued.code,
      emails,
      port: (await simulator.ready).port,
      dispose: async () => {
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
