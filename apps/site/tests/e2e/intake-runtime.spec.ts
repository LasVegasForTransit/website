import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare, Response as RuntimeResponse, convertV4MiniflareOptions } from 'miniflare';
import { applyMigrations } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';

const root = fileURLToPath(new URL('../../', import.meta.url));
const data = await mkdtemp(join(tmpdir(), 'lvbt-intake-runtime-'));
const origin = 'https://preview.lasvegasfortransit.org';
const question = 'Finishing this form will sign you up for our email newsletter. Is this okay?';
const submittedAt = '2026-06-15T18:00:00.000Z';
let providerCalls = 0;
let unavailable = false;
const simulator = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: await readFile(join(root, '.wrangler/worker/index.js'), 'utf8'),
    compatibilityDate: '2026-09-04',
    compatibilityFlags: ['nodejs_compat'],
    resourcePersistencePath: data,
    cf: false,
    telemetry: { enabled: false },
    bindings: {
      LVBT_DEPLOYMENT_ENV: 'preview',
      LVBT_MEMBERSHIP_INTAKE_SECRET: 'intake-runtime-fixture',
      LVBT_NOTION_API_KEY: 'notion-runtime-fixture',
      LVBT_NOTION_DATA_SOURCE_ID: 'intake-runtime-source',
    },
    d1Databases: { PLATFORM_DB: 'intake-runtime-fixture' },
    assets: {
      directory: join(root, 'dist'),
      binding: 'ASSETS',
      run_worker_first: true,
      routerConfig: { has_user_worker: true },
    },
    outboundService: (request) => {
      providerCalls++;
      assert.equal(
        request.url,
        'https://api.notion.com/v1/data_sources/intake-runtime-source/query',
      );
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.get('Authorization'), 'Bearer notion-runtime-fixture');
      return new RuntimeResponse(JSON.stringify({ results: [{ id: 'fixture-page' }] }), {
        status: unavailable ? 503 : 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  }),
);

async function post(path: string, body: object) {
  return await simulator.dispatchFetch(`${origin}${path}`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer intake-runtime-fixture',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}
function form(email: string, responseId: string, answer = 'Yes') {
  return {
    email,
    name: 'Intake Fixture',
    responseId,
    submittedAt,
    answers: { [question]: answer },
  };
}
try {
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
  const people = new PersonService(db);
  assert.equal(
    (
      await post('/api/intake/v1', {
        idempotencyKey: 'versioned-fixture',
        source: 'external_form',
        submittedAt,
        person: { email: 'versioned@example.invalid' },
        consent: { newsletter: true, wordingVersion: 'fixture' },
      })
    ).status,
    200,
  );
  assert.equal(providerCalls, 0, 'versioned intake must accept a signup without provider calls');
  assert.equal(
    (await post('/api/membership-intake', form('legacy@example.invalid', 'legacy'))).status,
    200,
  );
  const member = await db
    .prepare("SELECT id,membership_status FROM people WHERE email='legacy@example.invalid'")
    .first<{ id: string; membership_status: string }>();
  assert.equal(member?.membership_status, 'member');
  assert.ok(member);
  assert.equal(
    (
      await db
        .prepare('SELECT given_at FROM consent_records WHERE person_id=?')
        .bind(member.id)
        .first()
    )?.given_at,
    submittedAt,
  );
  assert.equal(
    (
      await db
        .prepare('SELECT state FROM newsletter_sync_jobs WHERE person_id=?')
        .bind(member.id)
        .first()
    )?.state,
    'queued',
  );
  await people.withdrawConsent(member.id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: '2026-07-01T00:00:00.000Z',
  });
  assert.equal(
    (await post('/api/membership-intake', form('legacy@example.invalid', 'older-replay'))).status,
    200,
  );
  assert.equal((await people.getPerson(member.id))?.membership_status, 'former_member');
  assert.equal(
    (await post('/api/membership-intake', form('declined@example.invalid', 'declined', 'No')))
      .status,
    200,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT membership_status FROM people WHERE email='declined@example.invalid'")
        .first()
    )?.membership_status,
    'not_member',
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT e.type FROM engagement_events e JOIN people p ON p.id=e.person_id WHERE p.email='declined@example.invalid'",
        )
        .first()
    )?.type,
    'form_response',
  );
  unavailable = true;
  assert.equal(
    (await post('/api/membership-intake', form('outage@example.invalid', 'outage'))).status,
    502,
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT p.membership_status,j.state FROM people p JOIN newsletter_sync_jobs j ON j.person_id=p.id WHERE p.email='outage@example.invalid'",
        )
        .first()
    )?.state,
    'queued',
  );
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) AS n FROM intake_submissions WHERE instr(idempotency_key,'@')>0")
        .first()
    )?.n,
    0,
  );
  console.log(
    JSON.stringify({
      runtime: 'compiled intake Worker',
      checks: [
        'provider-independent signup',
        'original consent time',
        'durable newsletter delivery',
        'older replay preserves later withdrawal',
        'negative answer does not create a member',
        'follow-up outage preserves accepted signup',
        'receipts exclude contact addresses',
      ],
      providers: 'isolated fixture',
    }),
  );
} finally {
  await simulator.dispose();
  await rm(data, { recursive: true, force: true });
}
