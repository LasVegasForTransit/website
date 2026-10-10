import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { applyMigrations } from '@lasvegasfortransit/platform-storage/test-db';
import { runMaintenance } from '@lasvegasfortransit/platform-storage/retention';
const root = fileURLToPath(new URL('../../', import.meta.url));
const data = await mkdtemp(join(tmpdir(), 'lvbt-maintenance-fixture-'));
const simulator = new Miniflare(
  convertV4MiniflareOptions({
    name: 'lvbt-maintenance-fixture',
    modules: true,
    scriptPath: join(root, 'dist/index.js'),
    compatibilityDate: '2026-09-04',
    compatibilityFlags: ['nodejs_compat'],
    resourcePersistencePath: data,
    cf: false,
    telemetry: { enabled: false },
    d1Databases: { PLATFORM_DB: 'maintenance-fixture' },
    bindings: { LVBT_DEPLOYMENT_ENV: 'preview', LVBT_DISCORD_SYNC_ENABLED: 'false' },
    outboundService: () => {
      throw new Error('Maintenance must not need external providers');
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
  const stamp = new Date().toISOString();
  await db.batch([
    db.prepare(
      "WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<105) INSERT INTO staff_audits(id,actor_id,action,occurred_at) SELECT 'old-'||n,'platform:discord','access.granted','2000-01-01T00:00:00.000Z' FROM seq",
    ),
    db.prepare(
      "WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<105) INSERT INTO person_views(id,actor_id,person_id,occurred_at) SELECT 'old-'||n,'staff','person','2000-01-01T00:00:00.000Z' FROM seq",
    ),
    db
      .prepare(
        "INSERT INTO staff_audits(id,actor_id,action,occurred_at) VALUES('recent','staff','access.granted',?)",
      )
      .bind(stamp),
    db
      .prepare(
        "INSERT INTO person_views(id,actor_id,person_id,occurred_at) VALUES('recent','staff','person',?)",
      )
      .bind(stamp),
    db
      .prepare("INSERT INTO people(id,created_at,updated_at) VALUES('person',?,?)")
      .bind(stamp, stamp),
    db.prepare(
      "INSERT INTO reconcile_generations(person_id,target_id,generation) VALUES('person','person',1)",
    ),
    db
      .prepare(
        "INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at) VALUES('no-provider','person_reconcile','person','person',1,'{}',?,?,?)",
      )
      .bind(stamp, stamp, stamp),
    db.prepare(
      "INSERT INTO welcome_claims VALUES('expired','person','person','2000-01-01T00:00:00.000Z','2000-01-08T00:00:00.000Z')",
    ),
  ]);
  await db
    .prepare(
      "WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<105) INSERT INTO people(id,given_name,email,created_at,updated_at,deleted_at) SELECT 'deleted-'||n,'Legacy private','deleted-'||n||'@example.invalid','2000-01-01T00:00:00.000Z','2000-01-01T00:00:00.000Z','2000-01-01T00:00:00.000Z' FROM seq",
    )
    .run();
  const worker = await simulator.getWorker();
  assert.equal((await worker.fetch('https://jobs.example.invalid/')).status, 404);
  assert.equal((await worker.scheduled({ cron: '* * * * *' })).outcome, 'ok');
  assert.equal(
    (await db.prepare("SELECT state FROM integration_outbox WHERE id='no-provider'").first())
      ?.state,
    'done',
    'the disabled-provider path must close work that has no verified provider identities',
  );
  for (const table of ['staff_audits', 'person_views'])
    assert.equal(
      (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first())?.n,
      6,
      'maintenance must remain bounded',
    );
  assert.equal((await db.prepare('SELECT count(*) AS n FROM welcome_claims').first())?.n, 0);
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM people').first())?.n,
    6,
    'profile cleanup must remain bounded',
  );
  for (let tick = 0; tick < 2; tick++)
    assert.equal((await worker.scheduled({ cron: '* * * * *' })).outcome, 'ok');
  for (const table of ['staff_audits', 'person_views']) {
    assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table}`).first())?.n, 1);
    assert.equal((await db.prepare(`SELECT id FROM ${table}`).first())?.id, 'recent');
    await assert.rejects(db.prepare(`DELETE FROM ${table}`).run(), /retention/);
  }
  assert.equal((await db.prepare('SELECT count(*) AS n FROM audit_retention_scope').first())?.n, 0);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM people').first())?.n, 1);
  for (const table of ['person_retention_scope', 'person_erasure_scope', 'person_erasure_copies'])
    assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table}`).first())?.n, 0);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT count(*) AS n FROM person_keys WHERE id LIKE 'deleted-%' AND erased_at IS NOT NULL",
        )
        .first()
    )?.n,
    105,
  );
  await db
    .prepare(
      "INSERT INTO people(id,created_at,updated_at,deleted_at) VALUES('count-fixture','2000-01-01','2000-01-01','2000-01-01')",
    )
    .run();
  const metrics = await runMaintenance(db, { limit: 1 });
  assert.equal(metrics.profilesErased, 1, 'D1 trigger writes must not inflate the profile count');
  assert.equal(metrics.profilesRemoved, 1);
  console.log(
    JSON.stringify({
      runtime: 'compiled scheduled jobs Worker',
      checks: [
        'bounded actual D1 audit retention',
        'bounded legacy erasure and 30-day physical profile cleanup',
        'record-view retention',
        'expired welcome claim',
        'repeat-safe maintenance with Discord disabled',
        'recent records retained',
        'direct audit deletion rejected',
        'no persistent deletion permission',
        'no external provider request',
      ],
    }),
  );
} finally {
  await simulator.dispose();
  await rm(data, { recursive: true, force: true });
}
