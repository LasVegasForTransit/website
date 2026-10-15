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

const data = await mkdtemp(join(tmpdir(), 'lvbt-newsletter-free-'));
const email = 'free-plan-member@example.invalid';
let status: string | null = null;
const calls: string[] = [];
const subscription = () => ({
  id: 'sub_free_fixture',
  email,
  status,
  created: Math.floor(Date.now() / 1000) - 60,
});
const simulator = new Miniflare(
  convertV4MiniflareOptions({
    name: 'lvbt-newsletter-free-fixture',
    modules: true,
    scriptPath: fileURLToPath(new URL('../../dist/index.js', import.meta.url)),
    compatibilityDate: '2026-09-04',
    compatibilityFlags: ['nodejs_compat'],
    resourcePersistencePath: data,
    cf: false,
    telemetry: { enabled: false },
    d1Databases: { PLATFORM_DB: 'newsletter-free-fixture' },
    bindings: {
      LVBT_DEPLOYMENT_ENV: 'preview',
      LVBT_DISCORD_SYNC_ENABLED: 'false',
      LVBT_BEEHIIV_SYNC_ENABLED: 'true',
      LVBT_BEEHIIV_CONFLICT_POLICY: 'staff_review',
      LVBT_BEEHIIV_PUBLICATION_ID: 'pub_free_fixture',
      LVBT_BEEHIIV_PRODUCTION_PUBLICATION_ID: 'pub_production',
      LVBT_BEEHIIV_API_KEY: 'fixture-only',
      LVBT_NEWSLETTER_INTENT_KEY: randomToken(),
    },
    outboundService: async (request) => {
      const url = new URL(request.url);
      assert.equal(url.origin, 'https://api.beehiiv.com');
      assert.equal(request.headers.get('Authorization'), 'Bearer fixture-only');
      calls.push(request.method);
      const json = (value: unknown) =>
        new RuntimeResponse(JSON.stringify(value), {
          headers: { 'Content-Type': 'application/json' },
        });
      if (request.method === 'POST') {
        const body = (await request.json()) as { email: string; send_welcome_email: boolean };
        assert.equal(body.email, email);
        assert.equal(body.send_welcome_email, false);
        status = 'active';
      }
      if (request.method === 'PATCH') status = 'inactive';
      if (url.pathname.endsWith('/subscriptions') && request.method === 'GET')
        return json({ data: status ? [subscription()] : [], has_more: false });
      return status ? json({ data: subscription() }) : new RuntimeResponse(null, { status: 404 });
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
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  const worker = await simulator.getWorker();
  const tick = async () =>
    assert.equal((await worker.scheduled({ cron: '* * * * *' })).outcome, 'ok');
  const scan = async () => {
    await db
      .prepare("UPDATE beehiiv_poll_checkpoints SET next_scan_at='2000-01-01T00:00:00.000Z'")
      .run();
    await tick();
  };
  await tick();
  assert.equal(status, 'active');
  assert.equal(
    (await db.prepare('SELECT in_progress FROM beehiiv_poll_checkpoints').first())?.in_progress,
    0,
  );
  assert.equal(calls.filter((method) => method === 'POST').length, 1);
  assert.equal(
    (
      await worker.fetch('https://jobs.internal/newsletter/event', {
        method: 'POST',
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
      })
    ).status,
    503,
  );
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM newsletter_inbound_events').first())?.n,
    0,
  );
  status = 'inactive';
  await scan();
  assert.equal(
    (await people.getPerson(person.id))?.membership_status,
    'former_member',
    'a real API-only scan must apply a routine external unsubscribe',
  );
  assert.deepEqual(
    await db
      .prepare(
        "SELECT time_basis,source_occurred_at FROM consent_withdrawals WHERE source='beehiiv_observed'",
      )
      .first(),
    { time_basis: 'observed', source_occurred_at: null },
  );
  await people.recordConsent(person.id, {
    scope: 'newsletter',
    source: 'account',
    method: 'checkbox',
    wordingVersion: 'fixture-rejoin',
    givenAt: new Date().toISOString(),
    renew: true,
  });
  await tick();
  assert.equal(status, 'active', 'a new explicit signup after the observation may rejoin');
  await people.withdrawConsent(person.id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: new Date().toISOString(),
  });
  await tick();
  assert.equal(status, 'inactive');
  assert.equal(
    (
      await db
        .prepare('SELECT state FROM newsletter_sync_jobs WHERE person_id=?')
        .bind(person.id)
        .first()
    )?.state,
    'done',
  );
  const count = calls.length;
  await tick();
  assert.equal(calls.length, count);

  await people.recordConsent(person.id, {
    scope: 'newsletter',
    source: 'account',
    method: 'checkbox',
    wordingVersion: 'fixture-active-baseline',
    givenAt: new Date().toISOString(),
    renew: true,
  });
  await tick();
  assert.equal(status, 'active');
  await scan();
  const baseline = await db
    .prepare('SELECT status,observed_at FROM beehiiv_subscription_observations')
    .first<{ status: string; observed_at: string }>();
  assert.equal(baseline?.status, 'active');
  assert.ok(baseline);
  const freshSignupAt = new Date(
    Math.max(Date.now(), Date.parse(baseline.observed_at) + 1),
  ).toISOString();
  await people.recordConsent(person.id, {
    scope: 'newsletter',
    source: 'account',
    method: 'checkbox',
    wordingVersion: 'fixture-uncertain-order',
    givenAt: freshSignupAt,
    renew: true,
  });
  status = 'inactive';
  const writesBeforeReview = calls.filter((method) => ['POST', 'PATCH'].includes(method)).length;
  await scan();
  assert.equal(
    (await people.getPerson(person.id))?.membership_status,
    'member',
    'an unsubscribe observed after a recent signup must preserve membership for staff review',
  );
  const review = await db
    .prepare('SELECT state,reason,baseline_active_at,observed_at FROM newsletter_poll_choices')
    .first<{
      state: string;
      reason: string;
      baseline_active_at: string;
      observed_at: string;
    }>();
  assert.ok(review);
  assert.equal(review.state, 'needs_review');
  assert.equal(review.reason, 'choice_order_unknown');
  assert.ok(Date.parse(review.baseline_active_at) < Date.parse(freshSignupAt));
  assert.ok(Date.parse(freshSignupAt) <= Date.parse(review.observed_at));
  assert.equal(
    calls.filter((method) => ['POST', 'PATCH'].includes(method)).length,
    writesBeforeReview,
    'staff review must hold conflicting provider writes',
  );
  await db
    .prepare("UPDATE newsletter_sync_jobs SET next_attempt_at='2000-01-01T00:00:00.000Z'")
    .run();
  await scan();
  assert.equal((await people.getPerson(person.id))?.membership_status, 'member');
  assert.equal(
    (await db.prepare('SELECT state FROM newsletter_poll_choices').first())?.state,
    'needs_review',
  );
  assert.equal(
    calls.filter((method) => ['POST', 'PATCH'].includes(method)).length,
    writesBeforeReview,
    'repeating the scan and due reconciliation must keep conflicting writes held',
  );
  console.log(
    JSON.stringify({
      runtime: 'compiled scheduled jobs Worker',
      checks: [
        'Free API configuration without webhook key',
        'signup and withdrawal with separate readback',
        'roster polling',
        'external unsubscribe changes membership without inventing choice time',
        'new explicit signup after an observed unsubscribe can rejoin',
        'signed intake remains closed',
        'completed work stays complete',
        'unclear unsubscribe and recent signup preserve membership for staff review',
        'staff review holds conflicting writes across repeated scans and reconciliation',
      ],
    }),
  );
} finally {
  await simulator.dispose();
  await rm(data, { recursive: true, force: true });
}
