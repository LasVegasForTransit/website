import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare, Response as RuntimeResponse, convertV4MiniflareOptions } from 'miniflare';
import { applyMigrations } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { randomToken } from '@lasvegasfortransit/platform-core/random-token';

const root = fileURLToPath(new URL('../../', import.meta.url));
const data = await mkdtemp(join(tmpdir(), 'lvbt-newsletter-runtime-'));
const subscriptions = new Map<
  string,
  { id: string; email: string; status: string; created: number }
>();
const calls: { method: string; path: string }[] = [];
let ambiguous = false;
const simulator = new Miniflare(
  convertV4MiniflareOptions({
    name: 'lvbt-newsletter-fixture',
    modules: true,
    scriptPath: join(root, 'dist/index.js'),
    compatibilityDate: '2026-09-04',
    compatibilityFlags: ['nodejs_compat'],
    resourcePersistencePath: data,
    cf: false,
    telemetry: { enabled: false },
    d1Databases: { PLATFORM_DB: 'newsletter-fixture' },
    bindings: {
      LVBT_DEPLOYMENT_ENV: 'preview',
      LVBT_DISCORD_SYNC_ENABLED: 'false',
      LVBT_BEEHIIV_SYNC_ENABLED: 'true',
      LVBT_BEEHIIV_PUBLICATION_ID: 'pub_fixture',
      LVBT_BEEHIIV_PRODUCTION_PUBLICATION_ID: 'pub_production',
      LVBT_BEEHIIV_API_KEY: 'fixture-only',
      LVBT_NEWSLETTER_INTENT_KEY: randomToken(),
    },
    outboundService: async (request) => {
      const url = new URL(request.url);
      assert.equal(url.origin, 'https://api.beehiiv.com');
      assert.equal(request.headers.get('Authorization'), 'Bearer fixture-only');
      calls.push({ method: request.method, path: url.pathname });
      const json = (value: unknown) =>
        new RuntimeResponse(JSON.stringify(value), {
          headers: { 'Content-Type': 'application/json' },
        });
      if (url.pathname.endsWith('/subscriptions') && request.method === 'GET')
        return json({ data: [...subscriptions.values()], has_more: false });
      if (request.method === 'POST') {
        const body = (await request.json()) as { email: string };
        const subscription = {
          id: `sub_fixture_${subscriptions.size}`,
          email: body.email,
          status: 'active',
          created: Math.floor(Date.now() / 1000) - 60,
        };
        subscriptions.set(subscription.id, subscription);
        return ambiguous
          ? new RuntimeResponse(null, { status: 503 })
          : json({ data: subscription });
      }
      const part = url.pathname.split('/').at(-1) ?? '';
      const subscription = url.pathname.includes('/by_email/')
        ? [...subscriptions.values()].find((value) => value.email === decodeURIComponent(part))
        : subscriptions.get(part);
      if (!subscription) return new RuntimeResponse(null, { status: 404 });
      if (request.method === 'PATCH') subscription.status = 'inactive';
      return json({ data: subscription });
    },
  }),
);
try {
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
  const people = new PersonService(db);
  const add = async (email: string) =>
    (
      await people.upsertFromSource({
        source: 'join_form',
        fields: { email },
        consent: {
          scope: 'newsletter',
          source: 'join_form',
          method: 'checkbox',
          wordingVersion: 'fixture',
        },
      })
    ).person;
  const person = await add('scheduled@example.invalid');
  const worker = await simulator.getWorker();
  const tick = async () =>
    assert.equal((await worker.scheduled({ cron: '* * * * *' })).outcome, 'ok');
  await tick();
  assert.equal(
    [...subscriptions.values()].some(
      (value) => value.email === 'scheduled@example.invalid' && value.status === 'active',
    ),
    true,
    'the compiled scheduled Worker must deliver accepted newsletter requests',
  );
  assert.equal(
    (
      await db
        .prepare('SELECT state FROM newsletter_sync_jobs WHERE person_id=?')
        .bind(person.id)
        .first()
    )?.state,
    'done',
  );
  const firstCalls = calls.length;
  await tick();
  assert.equal(calls.length, firstCalls, 'completed work must not repeat creation');
  await people.withdrawConsent(person.id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: new Date().toISOString(),
  });
  await tick();
  assert.equal(
    [...subscriptions.values()].find((value) => value.email === 'scheduled@example.invalid')
      ?.status,
    'inactive',
  );
  ambiguous = true;
  const erased = await add('erased-scheduled@example.invalid');
  await tick();
  assert.equal(
    (
      await db
        .prepare('SELECT state FROM newsletter_sync_jobs WHERE person_id=?')
        .bind(erased.id)
        .first()
    )?.state,
    'retry',
  );
  await people.deletePerson(erased.id);
  await tick();
  assert.equal(
    [...subscriptions.values()].find((value) => value.email === 'erased-scheduled@example.invalid')
      ?.status,
    'inactive',
  );
  assert.equal(
    (
      await db
        .prepare('SELECT state FROM newsletter_sync_jobs WHERE person_id=?')
        .bind(erased.id)
        .first()
    )?.state,
    'done',
  );
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM newsletter_write_intents').first())?.n,
    0,
  );
  assert.equal(
    (await worker.fetch('https://jobs.example.invalid/newsletter/reconcile')).status,
    404,
  );
  console.log(
    JSON.stringify({
      runtime: 'compiled scheduled jobs Worker',
      provider: 'isolated Beehiiv fixture',
      checks: [
        'signup readback',
        'repeat-safe dispatch',
        'withdrawal',
        'ambiguous creation and erasure recovery',
        'no public newsletter endpoint',
      ],
    }),
  );
} finally {
  await simulator.dispose();
  await rm(data, { recursive: true, force: true });
}
