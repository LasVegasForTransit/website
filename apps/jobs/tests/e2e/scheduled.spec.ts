import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare, Response as RuntimeResponse, convertV4MiniflareOptions } from 'miniflare';
import { applyMigrations } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { enqueueOperation } from '@lasvegasfortransit/platform-storage/outbox';
const root = fileURLToPath(new URL('../../', import.meta.url));
const data = await mkdtemp(join(tmpdir(), 'lvbt-jobs-fixture-'));
const identityId = '222222222222222222';
const memberRoleId = '333333333333333333';
const committeeRoleId = '444444444444444444';
const unrelatedRoleId = '666666666666666666';
const guildId = '111111111111111111';
const roles = new Set([unrelatedRoleId]);
const calls: string[] = [];
const simulator = new Miniflare(
  convertV4MiniflareOptions({
    name: 'lvbt-jobs-fixture',
    modules: true,
    scriptPath: join(root, 'dist/index.js'),
    compatibilityDate: '2026-09-04',
    compatibilityFlags: ['nodejs_compat'],
    resourcePersistencePath: data,
    cf: false,
    telemetry: { enabled: false },
    d1Databases: { PLATFORM_DB: 'jobs-fixture' },
    bindings: {
      LVBT_DEPLOYMENT_ENV: 'preview',
      LVBT_DISCORD_SYNC_ENABLED: 'true',
      LVBT_DISCORD_APPLICATION_ID: '555555555555555555',
      LVBT_DISCORD_GUILD_ID: guildId,
      LVBT_DISCORD_PRODUCTION_GUILD_ID: '999999999999999999',
      LVBT_DISCORD_MEMBER_ROLE_ID: memberRoleId,
      LVBT_DISCORD_BOT_TOKEN: 'fixture-only',
    },
    outboundService: (request) => {
      const url = new URL(request.url);
      assert.equal(url.origin, 'https://discord.com');
      assert.equal(request.headers.get('Authorization'), 'Bot fixture-only');
      const route = `/api/v10/guilds/${guildId}/members/${identityId}`;
      assert.ok(url.pathname === route || url.pathname.startsWith(`${route}/roles/`));
      calls.push(`${request.method} ${url.pathname}`);
      const role = url.pathname.split('/').at(-1);
      assert.ok(role);
      if (request.method === 'PUT') roles.add(role);
      if (request.method === 'DELETE') roles.delete(role);
      return Promise.resolve(
        request.method === 'GET'
          ? new RuntimeResponse(
              JSON.stringify({
                user: {
                  id: identityId,
                  username: 'fixture.member',
                  global_name: 'Fixture Discord',
                  avatar: null,
                },
                roles: [...roles],
                pending: false,
                nick: null,
              }),
              { headers: { 'Content-Type': 'application/json' } },
            )
          : new RuntimeResponse(null, { status: 204 }),
      );
    },
  }),
);
try {
  const db = await simulator.getD1Database('PLATFORM_DB');
  await db.prepare('SELECT 1').first();
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
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'fixture@example.invalid', given_name: 'LVBT Member' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  await db
    .prepare(
      "INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at) VALUES('fixture-google-identity',?,'google_workspace','fixture-google-user','2026-10-09T00:00:00.000Z','self_linked','2026-10-09T00:00:00.000Z','2026-10-09T00:00:00.000Z')",
    )
    .bind(person.id)
    .run();
  await people.linkIdentity(person.id, {
    platform: 'discord',
    externalId: identityId,
    linkMethod: 'self_linked',
  });
  const stamp = new Date().toISOString();
  await db
    .prepare("UPDATE committees SET discord_role_id=?,updated_at=? WHERE id='civic-tech'")
    .bind(committeeRoleId, stamp)
    .run();
  await db
    .prepare(
      "INSERT INTO committee_assignments(id,person_id,committee_id,role,started_at,assigned_by,updated_at) VALUES('fixture-assignment',?,'civic-tech','member',?,?,?)",
    )
    .bind(person.id, stamp, person.id, stamp)
    .run();
  await db
    .prepare(
      "INSERT INTO reconcile_generations(person_id,target_id,generation) VALUES(?,'person',1),(?,'civic-tech',1)",
    )
    .bind(person.id, person.id)
    .run();
  await enqueueOperation(db, {
    id: 'fixture-job',
    kind: 'person_reconcile',
    personId: person.id,
    targetId: 'person',
    generation: 1,
    payload: {},
  });
  const worker = await simulator.getWorker();
  assert.equal((await worker.fetch('https://jobs.example.invalid/')).status, 404);
  assert.equal((await worker.scheduled({ cron: '* * * * *' })).outcome, 'ok');
  assert.deepEqual([...roles].sort(), [memberRoleId, committeeRoleId, unrelatedRoleId].sort());
  assert.equal(
    (await db.prepare('SELECT username FROM discord_profiles').first())?.username,
    'fixture.member',
  );
  assert.equal((await people.getPerson(person.id))?.given_name, 'LVBT Member');
  assert.equal(
    (
      await db
        .prepare("SELECT state FROM provider_operation_receipts WHERE operation_id='fixture-job'")
        .first()
    )?.state,
    'done',
  );
  assert.equal(
    (await db.prepare("SELECT state FROM integration_outbox WHERE id='fixture-job'").first())
      ?.state,
    'queued',
    'Discord success must not close shared work while the verified Google account is unconfirmed',
  );
  const firstCalls = calls.length;
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) AS n FROM staff_audits WHERE action='access.granted'")
        .first()
    )?.n,
    2,
  );
  await worker.scheduled({ cron: '* * * * *' });
  assert.equal(calls.length, firstCalls, 'fresh confirmations must not repeat requests');
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) AS n FROM staff_audits WHERE action='access.granted'")
        .first()
    )?.n,
    2,
    'fresh confirmations must not duplicate access-change history',
  );
  await db.prepare("UPDATE integration_outbox SET state='done' WHERE id='fixture-job'").run();
  roles.delete(memberRoleId);
  await db
    .prepare("UPDATE provider_scan_checkpoints SET next_scan_at='2000-01-01T00:00:00.000Z'")
    .run();
  await worker.scheduled({ cron: '* * * * *' });
  assert.equal(
    roles.has(memberRoleId),
    true,
    'a completed account must be revisited and manual role drift corrected',
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT generation FROM reconcile_generations WHERE person_id=? AND target_id='person'",
        )
        .bind(person.id)
        .first()
    )?.generation,
    1,
  );
  await people.withdrawConsent(person.id, {
    scope: 'newsletter',
    source: 'member',
    withdrawnAt: new Date().toISOString(),
  });
  await worker.scheduled({ cron: '* * * * *' });
  assert.deepEqual(
    [...roles],
    [unrelatedRoleId],
    'withdrawal must automatically queue and remove all managed roles',
  );
  await db
    .prepare(
      "UPDATE integration_outbox SET state='done' WHERE state IN ('queued','retry','running')",
    )
    .run();
  roles.add(memberRoleId);
  roles.add(committeeRoleId);
  await db
    .prepare("UPDATE provider_scan_checkpoints SET next_scan_at='2000-01-01T00:00:00.000Z'")
    .run();
  await worker.scheduled({ cron: '* * * * *' });
  assert.deepEqual(
    [...roles],
    [unrelatedRoleId],
    'a periodic check must remove manually restored roles from a former member',
  );
  await people.recordConsent(person.id, {
    scope: 'newsletter',
    source: 'join_form',
    method: 'checkbox',
    wordingVersion: 'fixture',
    givenAt: new Date().toISOString(),
  });
  await worker.scheduled({ cron: '* * * * *' });
  assert.deepEqual([...roles].sort(), [memberRoleId, committeeRoleId, unrelatedRoleId].sort());
  assert.equal((await db.prepare('SELECT count(*) AS n FROM discord_profiles').first())?.n, 1);
  await people.deletePerson(person.id);
  await worker.scheduled({
    cron: '* * * * *',
    scheduledTime: new Date(Date.now() + 31 * 86_400_000),
  });
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM people WHERE id=?').bind(person.id).first())?.n,
    0,
    'the scheduled job must remove expired profiles before reconciling retained access work',
  );
  assert.deepEqual(
    [...roles],
    [unrelatedRoleId],
    'deletion must automatically remove managed roles',
  );
  assert.equal((await db.prepare('SELECT count(*) AS n FROM discord_profiles').first())?.n, 0);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM access_observations').first())?.n, 0);
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM provider_access_intents').first())?.n,
    0,
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT count(*) AS n FROM staff_audits WHERE action='access.revoked' AND json_extract(details,'$.source')='person_deleted'",
        )
        .first()
    )?.n,
    2,
    'deletion needs confirmed cleanup evidence for each removed role',
  );
  console.log(
    JSON.stringify({
      runtime: 'compiled scheduled jobs Worker',
      provider: 'isolated Discord REST fixture',
      checks: [
        'member and committee grants',
        'actual role confirmation and separate profile',
        'fresh receipt skipped',
        'completed account revisited and manual role drift corrected',
        'automatic withdrawal cleanup',
        'periodic removal of manual grants to former members',
        'automatic deletion cleanup after physical profile retention without restoring erased profiles',
        'confirmed role changes recorded once with deletion cleanup evidence',
        'unrelated role preserved',
        'public HTTP denied',
      ],
    }),
  );
} finally {
  await simulator.dispose();
  await rm(data, { recursive: true, force: true });
}
