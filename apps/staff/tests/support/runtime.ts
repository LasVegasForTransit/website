import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare, Response as RuntimeResponse, convertV4MiniflareOptions } from 'miniflare';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { applyMigrations } from '@lasvegasfortransit/platform-storage/test-db';
import { ulid } from '@lasvegasfortransit/platform-core/ids';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { bootstrapStaffAdmin } from '@lasvegasfortransit/platform-storage/staff-roles';
import { CommitteeService } from '@lasvegasfortransit/platform-storage/committees';
import {
  createWorkspaceSession,
  linkWorkspaceIdentity,
} from '@lasvegasfortransit/platform-storage/workspace-link';
export const ORIGIN = 'https://staff.lasvegasfortransit.org';
const consent = {
  scope: 'newsletter' as const,
  source: 'join_form' as const,
  method: 'checkbox' as const,
  wordingVersion: 'join-form-v1',
};
function seedRoster(raw: DatabaseSync) {
  const stamp = new Date().toISOString();
  const person = raw.prepare(
    "INSERT INTO people(id,given_name,email,zip,membership_status,membership_rules_version,created_at,updated_at) VALUES (?,?,?,?,'member',1,?,?)",
  );
  const evidence = raw.prepare(
    "INSERT INTO consent_records(id,person_id,scope,given_at,source,method,wording_version,created_at,updated_at) VALUES (?,?,'newsletter',?,'import','checkbox','fixture-only',?,?)",
  );
  raw.exec('BEGIN');
  try {
    for (let i = 0; i < 5000; i++) {
      const id = ulid(Date.now() + i);
      const suffix = String(i).padStart(5, '0');
      person.run(
        id,
        `Rider${suffix}`,
        `rider${suffix}@example.invalid`,
        i % 2 === 0 ? '89104' : '89101',
        stamp,
        stamp,
      );
      evidence.run(ulid(), id, stamp, stamp, stamp);
    }
    raw.exec('COMMIT');
  } catch (error) {
    raw.exec('ROLLBACK');
    throw error;
  }
}
export async function startRuntime(options: { discord?: boolean } = {}) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const data = await mkdtemp(join(tmpdir(), 'lvbt-staff-browser-'));
  const certificate = join(data, 'fixture-cert.pem'),
    privateKey = join(data, 'fixture-key.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      privateKey,
      '-out',
      certificate,
      '-days',
      '1',
      '-subj',
      '/CN=staff.lasvegasfortransit.org',
    ],
    { stdio: 'ignore' },
  );
  const httpsKey = await readFile(privateKey, 'utf8'),
    httpsCert = await readFile(certificate, 'utf8');
  const keys = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'browser-fixture', alg: 'RS256' };
  const server = join(root, 'dist/server');
  const chunks = (await readdir(server, { recursive: true })).filter(
    (file) => file.endsWith('.mjs') && file !== 'entry.mjs',
  );
  const modules = ['entry.mjs', ...chunks].map((file) => ({
    type: 'ESModule' as const,
    path: join(server, file),
  }));
  const simulator = new Miniflare(
    convertV4MiniflareOptions({
      host: '127.0.0.1',
      port: 0,
      https: true,
      httpsKey,
      httpsCert,
      name: 'lvbt-staff-browser-fixture',
      modules,
      modulesRoot: server,
      compatibilityDate: '2026-09-04',
      compatibilityFlags: ['nodejs_compat'],
      resourcePersistencePath: data,
      cf: false,
      telemetry: { enabled: false },
      bindings: {
        LVBT_SIGN_IN_SECRET: 'local-browser-fixture-only',
        LVBT_ACCESS_TEAM_DOMAIN: 'lvbt.cloudflareaccess.com',
        LVBT_ACCESS_AUD: 'browser-fixture-app',
        ...(options.discord
          ? {
              LVBT_DEPLOYMENT_ENV: 'preview',
              LVBT_DISCORD_SYNC_ENABLED: 'true',
              LVBT_DISCORD_APPLICATION_ID: '555555555555555555',
              LVBT_DISCORD_GUILD_ID: '111111111111111111',
              LVBT_DISCORD_PRODUCTION_GUILD_ID: '999999999999999999',
              LVBT_DISCORD_MEMBER_ROLE_ID: '333333333333333333',
            }
          : {}),
      },
      d1Databases: { PLATFORM_DB: 'browser-fixture-db' },
      assets: {
        directory: join(root, 'dist/client'),
        binding: 'ASSETS',
        run_worker_first: true,
        routerConfig: { has_user_worker: true },
      },
      outboundService: (request) => {
        assert.equal(request.url, 'https://lvbt.cloudflareaccess.com/cdn-cgi/access/certs');
        return new RuntimeResponse(JSON.stringify({ keys: [jwk] }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    }),
  );
  try {
    const db = await simulator.getD1Database('PLATFORM_DB');
    await db.prepare('SELECT 1 AS ready').first();
    const files = await readdir(data, { recursive: true });
    const database = files.find((file) => file.includes('d1') && file.endsWith('.sqlite'));
    assert.ok(database, 'local D1 should have its own isolated SQLite file');
    const raw = new DatabaseSync(join(data, database));
    try {
      applyMigrations(raw);
      seedRoster(raw);
    } finally {
      raw.close();
    }
    const people = new PersonService(db);
    const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'local-browser-fixture-only' };
    async function staff(kind: 'admin' | 'lead') {
      const { person } = await people.upsertFromSource({
        source: 'join_form',
        fields: {
          email: `${kind}@example.invalid`,
          given_name: kind === 'admin' ? 'Amina' : 'Leon',
          family_name: 'Staff',
        },
        consent,
      });
      const workspace = {
        subject: `fixture-google-${kind}`,
        email: `${kind}@lasvegasfortransit.org`,
        givenName: null,
        familyName: null,
      };
      await linkWorkspaceIdentity(db, {
        workspace,
        personId: person.id,
        method: 'self_linked',
        operationId: `link-${kind}`,
      });
      const session = await createWorkspaceSession(env, workspace);
      assert.ok(session);
      const assertion = await new SignJWT({ email: workspace.email, type: 'app' })
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
        .setIssuer('https://lvbt.cloudflareaccess.com')
        .setAudience('browser-fixture-app')
        .setSubject(`fixture-access-${kind}`)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(keys.privateKey);
      return { person, session, assertion };
    }
    const admin = await staff('admin');
    await bootstrapStaffAdmin(db, {
      presidentPersonId: admin.person.id,
      workspaceSubject: 'fixture-google-admin',
      performedBy: 'local-fixture',
      operationId: 'bootstrap',
    });
    const lead = await staff('lead');
    const committees = new CommitteeService(db);
    const leadAssignment = await committees.assign({
      personId: lead.person.id,
      committeeId: 'events',
      role: 'lead',
      actorId: admin.person.id,
      operationId: 'lead-events',
    });
    assert.equal(leadAssignment.kind, 'ok');
    await db.prepare("UPDATE committees SET interest_ids='[\"events\"]' WHERE id='events'").run();
    const { person: welcomePerson } = await people.upsertFromSource({
      source: 'join_form',
      fields: {
        email: 'welcome-fixture@example.invalid',
        given_name: 'New',
        family_name: 'Member',
        phone: '7025550100',
      },
      consent,
    });
    await people.recordEngagement(welcomePerson.id, {
      type: 'joined',
      occurredAt: new Date().toISOString(),
      source: 'join_form',
      details: { interests: ['events'] },
    });
    const { person: inside } = await people.upsertFromSource({
      source: 'join_form',
      fields: {
        email: 'inside@example.invalid',
        given_name: 'Committee',
        family_name: 'Rider',
        zip: '89104',
      },
      consent,
    });
    await committees.assign({
      personId: inside.id,
      committeeId: 'events',
      role: 'member',
      actorId: admin.person.id,
      operationId: 'inside-events',
    });
    await people.recordEngagement(inside.id, {
      type: 'donated',
      occurredAt: new Date().toISOString(),
      source: 'givebutter',
      details: { amount: 4321, currency: 'USD' },
    });
    await people.updateFields(inside.id, { source: 'staff', fields: { phone: '+17025550200' } });
    const { person: reviewPerson } = await people.upsertFromSource({
      source: 'join_form',
      fields: {
        email: 'duplicate-fixture@example.invalid',
        given_name: 'Committee',
        family_name: 'Rider',
        phone: '+17025550200',
        zip: '89104',
      },
      consent,
    });
    return {
      simulator,
      port: (await simulator.ready).port,
      db,
      admin,
      lead,
      inside,
      welcomePerson,
      reviewPerson,
      leadAssignment: leadAssignment.value,
      committees,
      root,
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
