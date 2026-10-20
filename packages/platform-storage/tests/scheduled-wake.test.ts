import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb, applyMigrations } from './support/db';
import {
  dueScheduledSignals,
  acknowledgeScheduledSignal,
  nextProviderWork,
  nextProfileWork,
  nextInactiveWork,
  nextRecordWork,
} from '../src/scheduled-wake';
import { nextMemberPrivacyTime } from '../src/member-privacy-schedule';

const now = new Date('2026-10-20T12:35:00.000Z');
const later = '2026-10-21T12:35:00.000Z';
const providers = {
  guildId: 'guild',
  applicationId: 'app',
  commandContext: 'command',
  publicationId: 'pub_test',
};
async function sleepAll(db: ReturnType<typeof memoryDb>) {
  for (const signal of await dueScheduledSignals(db, now, 'configuration'))
    await acknowledgeScheduledSignal(db, signal, 'configuration', later);
}
void test('unchanged configurations and future schedules do not write or report due work', async () => {
  const db = memoryDb();
  await sleepAll(db);
  const before = db.raw.prepare('SELECT total_changes() AS n').get()?.n;
  assert.deepEqual(await dueScheduledSignals(db, now, 'configuration'), []);
  assert.equal(db.raw.prepare('SELECT total_changes() AS n').get()?.n, before);
  assert.equal((await dueScheduledSignals(db, now, 'new configuration')).length, 4);
});
void test('an input committed during processing survives its captured acknowledgment', async () => {
  const db = memoryDb();
  await sleepAll(db);
  db.raw.exec("UPDATE scheduled_work_signals SET next_run_at='1970-01-01' WHERE name='providers'");
  const signal = (await dueScheduledSignals(db, now, 'configuration'))[0];
  assert.ok(signal);
  db.raw
    .exec(`INSERT INTO newsletter_inbound_events(publication_id,id,type,subscription_id,email_key,fingerprint,occurred_at,received_at,state)
    VALUES('pub_test','event','subscription.deleted','subscription','opaque','fingerprint','2026-10-20T12:35:00.000Z','2026-10-20T12:35:00.000Z','pending')`);
  await acknowledgeScheduledSignal(db, signal, 'configuration', later);
  assert.equal((await dueScheduledSignals(db, now, 'configuration'))[0]?.name, 'providers');
});
void test('a profiles acknowledgment cannot clear a concurrent provider wake', async () => {
  const db = memoryDb();
  const profile = (await dueScheduledSignals(db, now, 'configuration')).find(
    (s) => s.name === 'profiles',
  );
  assert.ok(profile);
  await acknowledgeScheduledSignal(db, profile, 'configuration', later);
  assert.ok(
    (await dueScheduledSignals(db, now, 'configuration')).some((s) => s.name === 'providers'),
  );
});
void test('the additive migration starts existing work awake and survives old readers', () => {
  const db = memoryDb('0052_inactive_profile_selection.sql');
  db.raw.exec(
    "INSERT INTO people(id,given_name,created_at,updated_at,deleted_at) VALUES('person','Private','2026-10-20','2026-10-20','2026-10-20')",
  );
  applyMigrations(db.raw);
  assert.equal(
    db.raw
      .prepare("SELECT count(*) AS n FROM scheduled_work_signals WHERE next_run_at<'2026'")
      .get()?.n,
    4,
  );
});
void test('future source events wake at eligibility even without another write', async () => {
  const db = memoryDb();
  db.raw
    .exec(`INSERT INTO newsletter_inbound_events(publication_id,id,type,subscription_id,email_key,fingerprint,occurred_at,received_at,state)
    VALUES('pub_test','future','subscription.deleted','subscription','opaque','fingerprint','2026-10-20T12:40:00.000Z','2026-10-20T12:35:00.000Z','pending')`);
  const next = await nextProviderWork(db, now, providers, false);
  assert.equal(next, '2026-10-20T12:40:00.000Z');
  for (const signal of await dueScheduledSignals(db, now, 'configuration'))
    await acknowledgeScheduledSignal(
      db,
      signal,
      'configuration',
      signal.name === 'providers' ? next : later,
    );
  assert.deepEqual(await dueScheduledSignals(db, now, 'configuration'), []);
  assert.equal(
    (await dueScheduledSignals(db, new Date(next), 'configuration'))[0]?.name,
    'providers',
  );
});
void test('an interrupted provider lease wakes when its lease expires', async () => {
  const db = memoryDb();
  db.raw.exec(
    "INSERT INTO provider_account_leases VALUES('discord','guild','identity','lease','2026-10-20T12:36:00.000Z')",
  );
  assert.equal(await nextProviderWork(db, now, providers, false), '2026-10-20T12:36:00.000Z');
});
void test('full passes resume next minute while empty providers reconcile at most every fifteen minutes', async () => {
  const db = memoryDb();
  assert.equal(await nextProviderWork(db, now, providers, true), '2026-10-20T12:36:00.000Z');
  assert.equal(await nextProviderWork(db, now, providers, false), '2026-10-20T12:50:00.000Z');
});
void test('profile purges retain their thirty-day deadline', async () => {
  const db = memoryDb();
  db.raw.exec(
    "INSERT INTO people(id,given_name,created_at,updated_at,deleted_at,erased_at) VALUES('person','Private','2026-10-01','2026-10-01','2026-10-01T12:00:00.000Z','2026-10-01T12:00:00.000Z')",
  );
  assert.equal(await nextProfileWork(db, now), '2026-10-31T12:00:00.001Z');
});
void test('unfinished inactivity work resumes while a completed day sleeps until the next Pacific window', async () => {
  const db = memoryDb();
  assert.equal(await nextInactiveWork(db, now), '2026-10-20T12:36:00.000Z');
  db.raw.exec(
    "INSERT INTO member_privacy_runs VALUES('2026-10-20','2025-04-20T10:00:00.000Z','operation','2026-10-20T12:00:00.000Z','2026-10-20T12:00:00.000Z')",
  );
  assert.equal(await nextInactiveWork(db, now), '2026-10-21T10:00:00.000Z');
});
void test('Pacific daily deadlines cross both daylight-saving transitions', () => {
  for (const [input, expected] of [
    ['2026-03-07T11:00:00.000Z', '2026-03-08T10:00:00.000Z'],
    ['2026-10-31T10:00:00.000Z', '2026-11-01T11:00:00.000Z'],
    ['2026-11-01T09:59:00.000Z', '2026-11-01T11:00:00.000Z'],
  ])
    assert.equal(nextMemberPrivacyTime(new Date(input ?? '')).toISOString(), expected);
});
void test('record cleanup continues hidden roster work before sleeping until the next hour', async () => {
  const db = memoryDb();
  assert.equal(await nextRecordWork(db, now), '2026-10-20T13:00:00.000Z');
  db.raw
    .exec(`INSERT INTO roster_import_records(id,source,source_id,evidence_hash,recorded_at,state,evidence,reasons)
    VALUES('record','beehiiv','source','hash','2026-01-01','held','{}','[]')`);
  assert.equal(await nextRecordWork(db, now), '2026-10-20T12:36:00.000Z');
});
void test('future inbound offsets use the same parsed time as source processing', async () => {
  const db = memoryDb();
  db.raw
    .exec(`INSERT INTO newsletter_inbound_events(publication_id,id,type,subscription_id,email_key,fingerprint,occurred_at,received_at,state)
    VALUES('pub_test','offset','subscription.deleted','subscription','opaque','fingerprint','2026-10-20T05:40:00-07:00','2026-10-20T12:35:00.000Z','pending')`);
  assert.equal(await nextProviderWork(db, now, providers, false), '2026-10-20T12:40:00.000Z');
});
void test('newsletter job deadlines include its own held lease and provider backoff', async () => {
  const db = memoryDb();
  db.raw
    .exec(`INSERT INTO people(id,given_name,created_at,updated_at) VALUES('person','Private','2026-10-20','2026-10-20');
    INSERT INTO newsletter_sync_jobs(person_id,generation,state,requested_at,next_attempt_at,lease_token,lease_expires_at)
      VALUES('person',1,'running','2026-10-20T12:30:00.000Z','2026-10-20T12:30:00.000Z','held','2026-10-20T12:36:30.000Z');`);
  assert.equal(await nextProviderWork(db, now, providers, false), '2026-10-20T12:36:30.000Z');
  db.raw.exec(
    "INSERT INTO newsletter_provider_backoffs VALUES('pub_test','2026-10-20T12:42:00.000Z')",
  );
  assert.equal(await nextProviderWork(db, now, providers, false), '2026-10-20T12:42:00.000Z');
});
void test('independent provider pauses gate their own checkpoints', async () => {
  const db = memoryDb();
  db.raw
    .exec(`INSERT INTO provider_scan_checkpoints(provider,context_id,started_at,next_scan_at,in_progress)
    VALUES('discord','guild','2026-10-20T12:00:00.000Z','2026-10-20T12:30:00.000Z',0);
    INSERT INTO provider_backoffs VALUES('discord','app','2026-10-20T12:44:00.000Z',1,'2026-10-20T12:35:00.000Z');`);
  assert.equal(await nextProviderWork(db, now, providers, false), '2026-10-20T12:44:00.000Z');
  db.raw.exec(
    "INSERT INTO newsletter_provider_backoffs VALUES('pub_test','2026-10-20T12:36:00.000Z')",
  );
  assert.equal(await nextProviderWork(db, now, providers, false), '2026-10-20T12:44:00.000Z');
});
void test('external lease releases, shortened backoffs and scan progress wake after acknowledgment', async () => {
  for (const [seed, change] of [
    [
      "INSERT INTO provider_backoffs VALUES('discord','app','2026-10-20T12:44:00.000Z',1,'2026-10-20T12:35:00.000Z')",
      "UPDATE provider_backoffs SET expires_at='2026-10-20T12:36:00.000Z'",
    ],
    [
      "INSERT INTO newsletter_provider_backoffs VALUES('pub_test','2026-10-20T12:44:00.000Z')",
      'DELETE FROM newsletter_provider_backoffs',
    ],
    [
      "INSERT INTO provider_account_leases VALUES('discord','guild','identity','lease','2026-10-20T12:36:00.000Z')",
      'DELETE FROM provider_account_leases',
    ],
    [
      "INSERT INTO newsletter_account_leases VALUES('pub_test','account','lease','2026-10-20T12:36:00.000Z')",
      'DELETE FROM newsletter_account_leases',
    ],
    [
      "INSERT INTO provider_scan_checkpoints(provider,context_id,started_at,next_scan_at,in_progress) VALUES('discord','guild','2026-10-20','2026-10-21',0)",
      'UPDATE provider_scan_checkpoints SET in_progress=1',
    ],
  ] as const) {
    const db = memoryDb();
    db.raw.exec(seed);
    await sleepAll(db);
    db.raw.exec(change);
    assert.deepEqual(
      (await dueScheduledSignals(db, now, 'configuration')).map((row) => row.name),
      ['providers'],
    );
  }
});
void test('unchanged checkpoint updates do not create a wake', async () => {
  const db = memoryDb();
  db.raw.exec(
    "INSERT INTO provider_scan_checkpoints(provider,context_id,started_at,next_scan_at,in_progress) VALUES('discord','guild','2026-10-20','2026-10-21',0)",
  );
  await sleepAll(db);
  db.raw.exec(
    'UPDATE provider_scan_checkpoints SET in_progress=in_progress,next_scan_at=next_scan_at',
  );
  assert.deepEqual(await dueScheduledSignals(db, now, 'configuration'), []);
});
void test('receipt freshness and expiry retain a future wake', async () => {
  const db = memoryDb();
  db.raw
    .exec(`INSERT INTO people(id,created_at,updated_at) VALUES('person','2026-10-20','2026-10-20');
    INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at)
      VALUES('operation','person_reconcile','person','person',1,'{}','2026-10-20T12:00:00.000Z','2026-10-20','2026-10-20');
    INSERT INTO provider_operation_receipts(operation_id,provider,state,revision_hash,lease_token,observed_at,expires_at)
      VALUES('operation','discord','done','revision','lease','2026-10-20T11:40:00.000Z','2026-10-20T12:45:00.000Z');`);
  assert.equal(await nextProviderWork(db, now, providers, false), '2026-10-20T12:40:00.000Z');
});
void test('merge eligibility changes wake profile erasure without changing the deletion time', async () => {
  const { mergeFixture } = await import('./support/merge-fixture');
  const f = await mergeFixture();
  assert.equal((await f.mergePeople(f.db, f.actor, f.input)).kind, 'ok');
  const before = f.db.raw
    .prepare('SELECT deleted_at FROM people WHERE id=?')
    .get(f.merged.id)?.deleted_at;
  await sleepAll(f.db);
  f.db.raw.exec("UPDATE merges SET unmerged_at='2026-10-20T12:35:00.000Z'");
  assert.equal(
    f.db.raw.prepare('SELECT deleted_at FROM people WHERE id=?').get(f.merged.id)?.deleted_at,
    before,
  );
  assert.ok(
    (await dueScheduledSignals(f.db, now, 'configuration')).some((row) => row.name === 'profiles'),
  );
  assert.equal(await nextProfileWork(f.db, now), '2026-10-20T12:36:00.000Z');
});
void test('hidden record categories drain in bounded minute batches', async () => {
  const { runMaintenance } = await import('../src/retention');
  const db = memoryDb();
  db.raw.exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<105)
    INSERT INTO google_group_check_failures SELECT 'customer','group-'||n||'@example.invalid','unknown','2026-01-01' FROM seq;
    WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<105)
    INSERT INTO google_group_inventory SELECT 'customer','group-'||n||'@example.invalid','group-'||n,'hash','2026-01-01','2026-01-01','2026-01-02',0,0 FROM seq;
    WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<105)
    INSERT INTO roster_import_records(id,source,source_id,evidence_hash,recorded_at,state,evidence,reasons)
      SELECT 'record-'||n,'beehiiv','source-'||n,'hash','2026-01-01','held','{}','[]' FROM seq;`);
  for (let pass = 0; pass < 10; pass++) {
    await runMaintenance(db, { now, category: 'records' });
    assert.equal(await nextRecordWork(db, now), '2026-10-20T12:36:00.000Z');
  }
  await runMaintenance(db, { now, category: 'records' });
  assert.equal(await nextRecordWork(db, now), '2026-10-20T13:00:00.000Z');
});
