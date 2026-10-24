import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
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
const data = await mkdtemp(join(tmpdir(), 'lvbt-newsletter-source-runtime-'));
const publicationId = 'pub_source_fixture';
const intentKey = randomToken();
const eventKey = 'fixture-source-event-key-only';
const sourceTime = Math.floor(Date.now() / 1000) - 60;
const subscriptions = Array.from({ length: 5000 }, (_, index) => ({
  id: `sub_roster_${index}`,
  email: `roster-${index}@example.invalid`,
  status: 'active',
  created: sourceTime - 3600,
}));
const calls: { method: string; list: boolean }[] = [];
const deletedSubscriptions = new Set<string>();
let pauseNextList = false;
const guildId = '111111111111111111';
const discordUserId = '222222222222222222';
const memberRoleId = '333333333333333333';
const unrelatedRoleId = '666666666666666666';
const discordRoles = new Set([memberRoleId, unrelatedRoleId]);

function json(value: unknown) {
  return Promise.resolve(
    new RuntimeResponse(JSON.stringify(value), {
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function discordResponse(
  request: { method: string; headers: { get(name: string): string | null } },
  url: URL,
) {
  assert.equal(request.headers.get('Authorization'), 'Bot fixture-only');
  if (url.pathname === `/api/v10/applications/555555555555555555/guilds/${guildId}/commands`) {
    assert.equal(request.method, 'GET');
    return json([
      {
        id: '101010101010101010',
        type: 1,
        name: 'link',
        description: 'Confirm your LVBT membership on the website',
      },
    ]);
  }
  if (url.pathname === `/api/v10/guilds/${guildId}/members`)
    return json([
      { user: { id: discordUserId, bot: false }, roles: [...discordRoles], pending: false },
    ]);
  const route = `/api/v10/guilds/${guildId}/members/${discordUserId}`;
  assert.ok(url.pathname === route || url.pathname.startsWith(`${route}/roles/`));
  const role = url.pathname.split('/').at(-1);
  assert.ok(role);
  if (request.method === 'DELETE') discordRoles.delete(role);
  if (request.method === 'PUT') discordRoles.add(role);
  return request.method === 'GET'
    ? json({
        user: {
          id: discordUserId,
          username: 'fixture.member',
          global_name: 'Fixture Discord',
          avatar: null,
        },
        roles: [...discordRoles],
        pending: false,
        nick: null,
      })
    : Promise.resolve(new RuntimeResponse(null, { status: 204 }));
}

function createRuntime() {
  return new Miniflare(
    convertV4MiniflareOptions({
      name: 'lvbt-newsletter-source-fixture',
      modules: true,
      scriptPath: join(root, 'dist/index.js'),
      compatibilityDate: '2026-09-04',
      compatibilityFlags: ['nodejs_compat'],
      resourcePersistencePath: data,
      cf: false,
      telemetry: { enabled: false },
      d1Databases: { PLATFORM_DB: 'newsletter-source-fixture' },
      bindings: {
        LVBT_DEPLOYMENT_ENV: 'production',
        LVBT_DISCORD_SYNC_ENABLED: 'true',
        LVBT_DISCORD_APPLICATION_ID: '555555555555555555',
        LVBT_DISCORD_GUILD_ID: guildId,
        LVBT_DISCORD_PRODUCTION_GUILD_ID: guildId,
        LVBT_DISCORD_MEMBER_ROLE_ID: memberRoleId,
        LVBT_DISCORD_BOT_TOKEN: 'fixture-only',
        LVBT_BEEHIIV_SYNC_ENABLED: 'true',
        LVBT_BEEHIIV_PUBLICATION_ID: publicationId,
        LVBT_BEEHIIV_PRODUCTION_PUBLICATION_ID: publicationId,
        LVBT_BEEHIIV_API_KEY: 'fixture-only',
        LVBT_NEWSLETTER_INTENT_KEY: intentKey,
        LVBT_BEEHIIV_WEBHOOK_SECRET: `whsec_${btoa(eventKey)}`,
      },
      outboundService: (request) => {
        const url = new URL(request.url);
        if (url.origin === 'https://discord.com') return discordResponse(request, url);
        assert.equal(url.origin, 'https://api.beehiiv.com');
        assert.equal(request.headers.get('Authorization'), 'Bearer fixture-only');
        const list = url.pathname.endsWith('/subscriptions');
        calls.push({ method: request.method, list });
        const id = url.pathname.split('/').at(-1);
        if (request.method === 'DELETE') {
          assert.equal(id, 'sub_roster_0', 'erasure must target only the removed member');
          deletedSubscriptions.add(id);
          return Promise.resolve(new RuntimeResponse(null, { status: 204 }));
        }
        assert.equal(
          request.method,
          'GET',
          'confirmed choices must not manufacture new subscriptions',
        );
        if (list) {
          assert.equal(url.searchParams.get('limit'), '100');
          if (pauseNextList) {
            pauseNextList = false;
            return Promise.resolve(
              new RuntimeResponse(null, { status: 429, headers: { 'Retry-After': '60' } }),
            );
          }
          const cursor = url.searchParams.get('cursor');
          const offset = cursor ? Number(cursor.replace('cursor_', '')) : 0;
          const end = offset + 100;
          return json({
            data: subscriptions
              .slice(offset, end)
              .filter((row) => !deletedSubscriptions.has(row.id)),
            has_more: end < subscriptions.length,
            ...(end < subscriptions.length ? { next_cursor: `cursor_${end}` } : {}),
          });
        }
        const row = url.pathname.includes('/by_email/')
          ? subscriptions.find((value) => value.email === decodeURIComponent(id ?? ''))
          : subscriptions.find((value) => value.id === id);
        return row && !deletedSubscriptions.has(row.id)
          ? json({ data: row })
          : Promise.resolve(new RuntimeResponse(null, { status: 404 }));
      },
    }),
  );
}

let simulator = createRuntime();
try {
  let db = await simulator.getD1Database('PLATFORM_DB');
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
  let worker = await simulator.getWorker();
  const tick = async () =>
    assert.equal((await worker.scheduled({ cron: '* * * * *' })).outcome, 'ok');
  const receive = async (
    id: string,
    index: number,
    type = 'subscription.confirmed',
    subscriptionId?: string,
  ) => {
    const row = subscriptions[index];
    assert.ok(row);
    const body = JSON.stringify({
      uid: id,
      event_type: type,
      event_timestamp: sourceTime,
      data: { id: subscriptionId ?? row.id, email: row.email, status: row.status },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const message = `message_${id}`;
    const signature = createHmac('sha256', eventKey)
      .update(`${message}.${timestamp}.${body}`)
      .digest('base64');
    assert.equal(
      (
        await worker.fetch('https://jobs.internal/newsletter/event', {
          method: 'POST',
          body,
          headers: {
            'Content-Type': 'application/json',
            'svix-id': message,
            'svix-timestamp': timestamp,
            'svix-signature': `v1,${signature}`,
          },
        })
      ).status,
      200,
    );
  };
  const known = subscriptions[0];
  assert.ok(known);
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: known.email },
    emailVerified: true,
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
      givenAt: new Date((sourceTime - 60) * 1000).toISOString(),
    },
  });
  await people.linkIdentity(person.id, {
    platform: 'beehiiv',
    externalId: known.id,
    externalEmail: known.email,
    linkMethod: 'verified_email',
  });
  await people.linkIdentity(person.id, {
    platform: 'discord',
    externalId: discordUserId,
    linkMethod: 'self_linked',
  });
  known.status = 'inactive';
  await receive('evt_withdrawn', 0, 'subscription.deleted');
  await receive('evt_withdrawn', 0, 'subscription.deleted');
  for (let i = 1; i <= 7; i++) await receive(`evt_confirmed_${i}`, i);
  await receive('evt_damaged', 9);
  await db
    .prepare(
      "UPDATE newsletter_inbound_events SET encrypted_email='fixture-damaged' WHERE id='evt_damaged'",
    )
    .run();

  for (let pass = 0; pass < 17; pass++) {
    if (pass === 3) {
      pauseNextList = true;
      await tick();
      assert.equal(
        (await db.prepare('SELECT accounts_read FROM beehiiv_poll_checkpoints').first())
          ?.accounts_read,
        900,
      );
      await simulator.dispose();
      simulator = createRuntime();
      db = await simulator.getD1Database('PLATFORM_DB');
      worker = await simulator.getWorker();
      await receive('evt_while_paused', 8);
      const before = calls.length;
      await tick();
      assert.equal(calls.length, before, 'a persisted pause must survive Worker restart');
      assert.equal(
        (
          await db
            .prepare("SELECT state FROM newsletter_inbound_events WHERE id='evt_while_paused'")
            .first()
        )?.state,
        'applied',
        'saved choices must apply even while provider requests are paused',
      );
      // Advance only the isolated fixture's retry clock after proving enforcement.
      await db.batch([
        db.prepare("UPDATE newsletter_provider_backoffs SET until_at='2000-01-01T00:00:00.000Z'"),
        db.prepare(
          "UPDATE beehiiv_poll_checkpoints SET next_attempt_at='2000-01-01T00:00:00.000Z'",
        ),
      ]);
    }
    const before = calls.filter((call) => call.list).length;
    await tick();
    assert.equal(calls.filter((call) => call.list).length - before, Math.min(3, 50 - pass * 3));
    assert.equal(
      (await db.prepare('SELECT accounts_read FROM beehiiv_poll_checkpoints').first())
        ?.accounts_read,
      Math.min((pass + 1) * 300, 5000),
    );
    if (pass === 0) {
      assert.equal((await people.getPerson(person.id))?.membership_status, 'former_member');
      assert.deepEqual(
        [...discordRoles],
        [unrelatedRoleId],
        'an authenticated newsletter withdrawal removes only managed Discord access',
      );
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM people WHERE deleted_at IS NULL').first())?.n,
        8,
      );
      assert.equal(
        (
          await db
            .prepare("SELECT state FROM newsletter_inbound_events WHERE id='evt_damaged'")
            .first()
        )?.state,
        'needs_review',
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT encrypted_email FROM newsletter_inbound_events WHERE id='evt_withdrawn'",
            )
            .first()
        )?.encrypted_email,
        null,
      );
    }
  }
  const scan = await db.prepare('SELECT * FROM beehiiv_poll_checkpoints').first();
  assert.ok(scan);
  assert.equal(scan.pages_read, 50);
  assert.equal(scan.accounts_read, 5000);
  assert.equal(scan.in_progress, 0);
  assert.equal(
    Date.parse(String(scan.next_scan_at)) - Date.parse(String(scan.started_at)),
    15 * 60_000,
  );
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM beehiiv_subscription_observations').first())?.n,
    5000,
  );
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM people WHERE deleted_at IS NULL').first())?.n,
    9,
    'delivery observations must not turn the full roster into new members',
  );
  const before = calls.length;
  await tick();
  assert.equal(calls.length, before, 'complete scans and choices must not repeat provider work');

  const scanBudget = await db
    .prepare('SELECT charged_writes FROM scheduled_work_budget')
    .first<{ charged_writes: number }>();
  assert.ok(
    scanBudget && scanBudget.charged_writes <= 45_000,
    'the complete roster scan must stay within the production daily allocation',
  );
  // Other admitted jobs can consume the remaining shared allocation. Fill only
  // this isolated ledger to prove erasure deferral at the current daily limit,
  // independently of the precise scan write count or wall-clock scheduling.
  await db.prepare('UPDATE scheduled_work_budget SET charged_writes=45000').run();
  await new PersonService(db).deletePerson(person.id);
  await receive('evt_after_erasure', 0, 'subscription.confirmed', 'sub_late_unlinked');
  assert.deepEqual(
    await db
      .prepare(
        "SELECT state,encrypted_email FROM newsletter_inbound_events WHERE id='evt_after_erasure'",
      )
      .first(),
    { state: 'ignored', encrypted_email: null },
  );
  await tick();
  assert.equal(await new PersonService(db).findByEmail(known.email), null);
  assert.equal(
    calls.every((call) => call.method === 'GET' || call.method === 'DELETE'),
    true,
  );
  assert.equal(calls.filter((call) => call.method === 'DELETE').length, 0);
  const spent = await db
    .prepare('SELECT charged_writes FROM scheduled_work_budget')
    .first<{ charged_writes: number }>();
  assert.ok(
    spent && spent.charged_writes <= 45_000 && spent.charged_writes + 4_000 > 45_000,
    'an exhausted shared allocation must defer subsequent work until the next day',
  );
  // Advance the isolated ledger day after proving that the real daily guard refused work.
  await db.prepare("UPDATE scheduled_work_budget SET utc_day='2000-01-01'").run();
  await tick();
  assert.equal(calls.filter((call) => call.method === 'DELETE').length, 1);
  assert.equal(deletedSubscriptions.has(known.id), true);
  console.log(
    JSON.stringify({
      runtime: 'compiled scheduled jobs Worker',
      provider: 'isolated newsletter and Discord fixtures',
      checks: [
        'authenticated source choices change canonical membership and Discord access',
        'damaged address review',
        '5000-account resumable scan in seventeen successful ticks',
        'daily allocation defers work and resumes deletion cleanup on the next UTC budget day',
        'rate-limit and Worker restart recovery',
        'incoming choices during a provider pause',
        'repeat safety',
        'erased unlinked callback rejected',
      ],
    }),
  );
} finally {
  await simulator.dispose();
  await rm(data, { recursive: true, force: true });
}
