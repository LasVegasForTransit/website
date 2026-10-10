import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import test from 'node:test';

void test('shared storage applies canonical migrations and preserves existing people on repeat migration', async () => {
  const loaded = await Promise.all([
    import('@lasvegasfortransit/platform-storage/person-service'),
    import('@lasvegasfortransit/platform-storage/test-db'),
  ]).catch(() => null);
  assert.ok(
    loaded,
    'both applications must be able to load shared person storage and its canonical database',
  );
  const [{ PersonService }, { memoryDb, applyMigrations }] = loaded;
  const db = memoryDb();
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'member@example.org' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'join-form-v1',
    },
  });
  applyMigrations(db.raw);
  assert.equal((await people.findByEmail('member@example.org'))?.id, person.id);
  assert.equal((await people.getPerson(person.id))?.membership_status, 'member');
  const rule = db.raw.prepare('SELECT version FROM membership_rules').get();
  assert.equal(rule?.version, 1);
  const applied = db.raw
    .prepare("SELECT count(*) AS count FROM d1_migrations WHERE name < '0009'")
    .get();
  assert.equal(applied?.count, 8);
  db.raw.close();
});

void test('the Workspace migration preserves legacy codes, sessions and duplicate-review evidence', async () => {
  const { applyMigrations } = await import('./support/db');
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys=ON; CREATE TABLE d1_migrations (name TEXT PRIMARY KEY)');
  applyMigrations(raw, '0008_onboarding_action_targeting.sql');
  raw.exec(`INSERT INTO people (id,email,created_at,updated_at) VALUES ('a','ana@example.org','stamp','stamp'),('b','bo@example.org','stamp','stamp');
    INSERT INTO sign_in_codes (id,person_id,purpose,code_hash,expires_at,created_at,updated_at) VALUES ('code','a','sign_in','hash','future','stamp','stamp');
    INSERT INTO sessions (id_hash,person_id,type,created_at,last_used_at,expires_at,updated_at) VALUES ('session','a','member','stamp','stamp','future','stamp');
    INSERT INTO review_queue (id,candidate_person_id,existing_person_id,reason,created_at,updated_at,details) VALUES ('review','a','b','same phone','stamp','stamp','{"note":"preserve"}');`);
  applyMigrations(raw, '0009_workspace_sign_in.sql');
  assert.equal(raw.prepare('SELECT code_hash FROM sign_in_codes').get()?.code_hash, 'hash');
  assert.equal(
    raw.prepare('SELECT workspace_link_id FROM sign_in_codes').get()?.workspace_link_id,
    null,
  );
  assert.equal(raw.prepare('SELECT person_id FROM sessions').get()?.person_id, 'a');
  assert.equal(
    raw.prepare('SELECT existing_person_id FROM review_queue').get()?.existing_person_id,
    'b',
  );
  assert.equal(
    raw.prepare('SELECT details FROM review_queue').get()?.details,
    '{"note":"preserve"}',
  );
  assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(), []);
  raw.close();
});

void test('the Google scan migration preserves Discord checkpoints and accepts Workspace customer scans', async () => {
  const { applyMigrations } = await import('./support/db');
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys=ON; CREATE TABLE d1_migrations (name TEXT PRIMARY KEY)');
  applyMigrations(raw, '0019_provider_scan_checkpoints.sql');
  raw
    .prepare(
      "INSERT INTO provider_scan_checkpoints(provider,context_id,started_at,next_scan_at,cursor,in_progress) VALUES('discord','guild','start','next','person',1)",
    )
    .run();
  applyMigrations(raw, '0027_google_provider_scans.sql');
  const preserved = raw
    .prepare('SELECT provider,context_id,cursor,in_progress FROM provider_scan_checkpoints')
    .get() as Record<string, unknown>;
  assert.equal(preserved.provider, 'discord');
  assert.equal(preserved.context_id, 'guild');
  assert.equal(preserved.cursor, 'person');
  assert.equal(preserved.in_progress, 1);
  raw
    .prepare(
      "INSERT INTO provider_scan_checkpoints(provider,context_id,started_at,next_scan_at,in_progress) VALUES('google_workspace','customer','start','next',0)",
    )
    .run();
  assert.throws(() =>
    raw
      .prepare(
        "INSERT INTO provider_scan_checkpoints(provider,context_id,started_at,next_scan_at,in_progress) VALUES('unknown','customer','start','next',0)",
      )
      .run(),
  );
  assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(), []);
  raw.close();
});

void test('the provider pause migration preserves Discord deadlines and adds Workspace customer keys', async () => {
  const { applyMigrations } = await import('./support/db');
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys=ON; CREATE TABLE d1_migrations (name TEXT PRIMARY KEY)');
  applyMigrations(raw, '0017_provider_backoff.sql');
  raw
    .prepare(
      "INSERT INTO provider_backoffs(provider,application_id,expires_at,is_global,updated_at) VALUES('discord','application','later',1,'stamp')",
    )
    .run();

  applyMigrations(raw, '0028_google_provider_backoffs.sql');

  const preserved = raw
    .prepare('SELECT provider,context_id,expires_at,is_global FROM provider_backoffs')
    .get() as Record<string, unknown>;
  assert.equal(preserved.provider, 'discord');
  assert.equal(preserved.context_id, 'application');
  assert.equal(preserved.expires_at, 'later');
  assert.equal(preserved.is_global, 1);
  raw
    .prepare(
      "INSERT INTO provider_backoffs(provider,context_id,expires_at,is_global,updated_at) VALUES('google_workspace','Cfixture','later',1,'stamp')",
    )
    .run();
  assert.throws(() =>
    raw
      .prepare(
        "INSERT INTO provider_backoffs(provider,context_id,expires_at,is_global,updated_at) VALUES('unknown','context','later',1,'stamp')",
      )
      .run(),
  );
  assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(), []);
  raw.close();
});
