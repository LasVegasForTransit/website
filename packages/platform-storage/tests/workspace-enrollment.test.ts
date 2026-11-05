import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memoryDb } from './support/db';
import { enrollWorkspaceAccount } from '../src/workspace-enrollment';
import { createSession, readSession } from '../src/auth';
import { createSsoSession } from '../src/staff-sso';
import { loadActor } from '../src/staff-roles';
import { can } from '@lasvegasfortransit/platform-core/permissions';
import { PersonService } from '../src/person-service';
import type {
  DirectoryAccount,
  WorkspacePolicy,
} from '@lasvegasfortransit/platform-core/workspace-onboarding';

const now = new Date('2026-11-04T20:00:00.000Z');
const policy: WorkspacePolicy = {
  environment: 'production',
  customerId: 'C-lvbt',
  humanOrgUnitIds: ['ou-people'],
  includedUserIds: [],
  excludedUserIds: ['service-001'],
  previewUserIds: [],
};
const account: DirectoryAccount = {
  customerId: 'C-lvbt',
  userId: 'google-001',
  email: 'avery@lasvegasfortransit.org',
  givenName: 'Avery',
  familyName: 'Reyes',
  orgUnitId: 'ou-people',
  suspended: false,
  archived: false,
  deleted: false,
  observedAt: now.toISOString(),
};
function existing(db: ReturnType<typeof memoryDb>, id = 'member', email = 'personal@example.org') {
  db.raw
    .prepare(
      "INSERT INTO people(id,email,membership_status,created_at,updated_at) VALUES(?,?,'member',?,?)",
    )
    .run(id, email, now.toISOString(), now.toISOString());
}
function identity(db: ReturnType<typeof memoryDb>, person = 'member') {
  db.raw
    .prepare(
      "INSERT INTO identities(id,person_id,platform,external_id,external_email,linked_at,link_method,created_at,updated_at) VALUES('workspace',?,'google_workspace','google-001',?,?,'staff_confirmed',?,?)",
    )
    .run(person, account.email, now.toISOString(), now.toISOString(), now.toISOString());
}

void test('new human enrollment creates one team account without consent or responsibilities', async () => {
  const db = memoryDb();
  const result = await enrollWorkspaceAccount(db, account, policy, now);
  assert.equal(result.kind, 'enrolled');
  assert.ok(result.personId);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 1);
  assert.equal(
    db.raw.prepare('SELECT membership_status FROM people').get()?.membership_status,
    'not_member',
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM staff_team_accounts').get()?.n, 1);
  for (const table of ['consent_records', 'committee_assignments', 'staff_administrators'])
    assert.equal(db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0);
});

void test('a recycled organization email cannot claim an established member or their Discord', async () => {
  const db = memoryDb();
  existing(db, 'member', String(account.email));
  const result = await enrollWorkspaceAccount(db, account, policy, now);
  assert.equal(result.kind, 'enrolled');
  assert.notEqual(result.personId, 'member');
  assert.equal(
    db.raw.prepare('SELECT email FROM people WHERE id=?').get(String(result.personId))?.email,
    null,
  );
  assert.equal(
    db.raw.prepare("SELECT membership_status FROM people WHERE id='member'").get()
      ?.membership_status,
    'member',
  );
  assert.equal(
    db.raw.prepare("SELECT person_id FROM identities WHERE platform='google_workspace'").get()
      ?.person_id,
    result.personId,
  );
});

void test('concurrent duplicate observations create no extra person or identity', async () => {
  const db = memoryDb();
  const results = await Promise.all([
    enrollWorkspaceAccount(db, account, policy, now),
    enrollWorkspaceAccount(db, account, policy, now),
  ]);
  assert.equal(results[0].personId, results[1].personId);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 1);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM identities').get()?.n, 1);
});

void test('stable ID linking preserves member email and rename keeps the same person', async () => {
  const db = memoryDb();
  existing(db);
  identity(db);
  const result = await enrollWorkspaceAccount(db, account, policy, now);
  assert.equal(result.personId, 'member');
  const later = new Date(now.getTime() + 1000);
  await enrollWorkspaceAccount(
    db,
    { ...account, email: 'avery.reyes@lasvegasfortransit.org', observedAt: later.toISOString() },
    policy,
    later,
  );
  assert.equal(
    db.raw.prepare("SELECT email FROM people WHERE id='member'").get()?.email,
    'personal@example.org',
  );
  assert.equal(
    db.raw.prepare("SELECT external_email FROM identities WHERE id='workspace'").get()
      ?.external_email,
    'avery.reyes@lasvegasfortransit.org',
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 1);
});

void test('suspension ends existing staff sessions and an older active observation cannot restore them', async () => {
  const db = memoryDb();
  const result = await enrollWorkspaceAccount(db, account, policy, now);
  const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-secret-only' };
  const session = await createSession(env, String(result.personId), 'staff', now);
  const later = new Date(now.getTime() + 1000);
  await enrollWorkspaceAccount(
    db,
    { ...account, suspended: true, observedAt: later.toISOString() },
    policy,
    later,
  );
  assert.equal(await readSession(env, session.token, later), null);
  const staleGrant = await createSession(env, String(result.personId), 'staff', later);
  assert.equal(await readSession(env, staleGrant.token, later), null);
  await enrollWorkspaceAccount(db, account, policy, later);
  assert.equal(db.raw.prepare('SELECT state FROM workspace_enrollments').get()?.state, 'inactive');
});

void test('unknown OUs and excluded service users do not create portal people', async () => {
  const db = memoryDb();
  const unknown = await enrollWorkspaceAccount(
    db,
    { ...account, orgUnitId: 'ou-unknown' },
    policy,
    now,
  );
  assert.equal(unknown.kind, 'review');
  const excluded = await enrollWorkspaceAccount(
    db,
    { ...account, userId: 'service-001' },
    policy,
    now,
  );
  assert.equal(excluded.kind, 'excluded');
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
});

void test('preview scope cannot enroll production accounts and future observations are refused', async () => {
  const db = memoryDb();
  assert.equal(
    (await enrollWorkspaceAccount(db, account, { ...policy, environment: 'preview' }, now)).kind,
    'excluded',
  );
  assert.equal(
    (
      await enrollWorkspaceAccount(
        db,
        { ...account, observedAt: '2026-11-05T20:00:00.000Z' },
        policy,
        now,
      )
    ).kind,
    'invalid',
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
  assert.equal(
    db.raw.prepare('SELECT count(*) AS n FROM workspace_directory_accounts').get()?.n,
    0,
  );
});

void test('approving a previously unknown human OU creates a provisional record that can be connected later', async () => {
  const db = memoryDb();
  await enrollWorkspaceAccount(db, { ...account, orgUnitId: 'ou-new' }, policy, now);
  const later = new Date(now.getTime() + 1000);
  const result = await enrollWorkspaceAccount(
    db,
    { ...account, orgUnitId: 'ou-new', observedAt: later.toISOString() },
    { ...policy, humanOrgUnitIds: ['ou-people', 'ou-new'] },
    later,
  );
  assert.equal(result.kind, 'enrolled');
  assert.equal(
    db.raw.prepare('SELECT provisional FROM workspace_enrollments').get()?.provisional,
    1,
  );
});

void test('an erased Google identity cannot be re-enrolled into a new person', async () => {
  const db = memoryDb();
  existing(db);
  identity(db);
  db.raw
    .prepare("UPDATE people SET deleted_at=?,erased_at=? WHERE id='member'")
    .run(now.toISOString(), now.toISOString());
  assert.equal((await enrollWorkspaceAccount(db, account, policy, now)).kind, 'blocked');
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 1);
});

void test('erasing an enrolled person preserves a valid provider-removal operation and clears Directory contact fields', async () => {
  const db = memoryDb();
  const enrolled = await enrollWorkspaceAccount(db, account, policy, now);
  await new PersonService(db).deletePerson(String(enrolled.personId));
  const e = db.raw.prepare('SELECT state,email FROM workspace_enrollments').get();
  assert.equal(e?.state, 'revoked');
  assert.equal(e.email, null);
  const job = db.raw
    .prepare(
      "SELECT payload FROM integration_outbox WHERE person_id=? AND state='queued' ORDER BY created_at DESC LIMIT 1",
    )
    .get(String(enrolled.personId));
  assert.equal((JSON.parse(String(job?.payload)) as { source: string }).source, 'person_deleted');
});

void test('active human former members get basic SSO without restoring membership', async () => {
  const db = memoryDb();
  existing(db);
  identity(db);
  db.raw.prepare("UPDATE people SET membership_status='former_member' WHERE id='member'").run();
  await enrollWorkspaceAccount(db, account, policy, now);
  const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-secret-only' };
  const signed = await createSsoSession(
    env,
    {
      issuer: 'https://fixture.cloudflareaccess.com',
      subject: 'principal-001',
      email: String(account.email),
      expiresAt: new Date(now.getTime() + 3600000),
    },
    now,
  );
  assert.ok(signed);
  const actor = await loadActor(db, 'member');
  assert.ok(actor);
  assert.equal(can(actor, 'attendance.record'), true);
  assert.equal(can(actor, 'console.enter'), false);
  assert.equal(can(actor, 'staff_admin.manage'), false);
  assert.equal(
    db.raw.prepare("SELECT membership_status FROM people WHERE id='member'").get()
      ?.membership_status,
    'former_member',
  );
});
