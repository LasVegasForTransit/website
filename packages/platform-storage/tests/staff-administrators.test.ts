import assert from 'node:assert/strict';
import test from 'node:test';
import { ulid } from '@lasvegasfortransit/platform-core/ids';
import { PersonService } from '../src/person-service';
import { loadActor, staffAdminManage } from '../src/staff-roles';
import type { Db } from '../src/db';
import { memoryDb } from './support/db';

async function fixture() {
  const db = memoryDb(),
    people = new PersonService(db);
  const member = async (name: string) =>
    (
      await people.upsertFromSource({
        source: 'join_form',
        fields: { email: `${name}@example.invalid`, given_name: name, family_name: 'Rider' },
        consent: {
          scope: 'newsletter',
          source: 'join_form',
          method: 'checkbox',
          wordingVersion: 'fixture',
        },
      })
    ).person;
  const admin = await member('admin'),
    target = await member('target'),
    other = await member('other');
  db.raw
    .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
    .run(admin.id, 'fixture', new Date().toISOString());
  await people.linkIdentity(target.id, {
    platform: 'google_workspace',
    externalId: 'target-google',
    externalEmail: 'target@lasvegasfortransit.org',
    linkMethod: 'self_linked',
  });
  const actor = await loadActor(db, admin.id);
  assert.ok(actor);
  const input = {
    targetPersonId: target.id,
    enabled: true,
    operationId: ulid(),
    expectedState: { updatedAt: target.updated_at, designatedAt: null as string | null },
    requireWorkspaceIdentity: true,
  };
  return { db, people, member, admin, target, other, actor, input };
}

void test('only current administrators can read designations, search members or open the confirmation record', async () => {
  const feature = await import('../src/staff-administrators').catch(() => null);
  assert.ok(feature, 'administrator management needs scoped minimal reads');
  const f = await fixture();
  try {
    const forged = { ...f.actor, personId: f.other.id };
    for (const read of [
      () => feature.listStaffAdministrators(f.db, forged),
      () => feature.searchStaffAdministratorCandidates(f.db, forged, 'target'),
      () => feature.staffAdministratorView(f.db, forged, f.target.id),
    ])
      await assert.rejects(read, { name: 'PermissionDenied' });
    const rows = await feature.listStaffAdministrators(f.db, f.actor);
    assert.deepEqual(
      rows.map((row) => row.id),
      [f.admin.id],
    );
    const target = await feature.staffAdministratorView(f.db, f.actor, f.target.id);
    assert.equal(target?.has_workspace, 1);
    assert.equal(target.designated_at, null);
    assert.equal(await feature.staffAdministratorView(f.db, f.actor, 'missing'), null);
  } finally {
    f.db.raw.close();
  }
});

void test('candidate search matches active member names and emails, escapes wildcards and returns at most25', async () => {
  const feature = await import('../src/staff-administrators').catch(() => null);
  assert.ok(feature);
  const f = await fixture();
  try {
    for (let index = 0; index < 30; index++)
      await f.member(`candidate${String(index).padStart(2, '0')}`);
    const literal = await f.member('literal%_rider');
    f.db.raw
      .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
      .run(f.other.id);
    assert.equal(
      (await feature.searchStaffAdministratorCandidates(f.db, f.actor, 'candidate')).length,
      25,
    );
    assert.deepEqual(
      (await feature.searchStaffAdministratorCandidates(f.db, f.actor, '%_')).map((row) => row.id),
      [literal.id],
    );
    assert.deepEqual(
      (
        await feature.searchStaffAdministratorCandidates(f.db, f.actor, 'TARGET@EXAMPLE.INVALID')
      ).map((row) => row.id),
      [f.target.id],
    );
    assert.deepEqual(await feature.searchStaffAdministratorCandidates(f.db, f.actor, 'other'), []);
    assert.deepEqual(await feature.searchStaffAdministratorCandidates(f.db, f.actor, ''), []);
  } finally {
    f.db.raw.close();
  }
});

void test('grant and revoke preserve exact replay receipts and attribute one audit per change without affecting another administrator', async () => {
  const f = await fixture();
  try {
    assert.equal((await staffAdminManage(f.db, f.actor, f.input)).kind, 'ok');
    const designatedAt = f.db.raw
      .prepare('SELECT designated_at FROM staff_administrators WHERE person_id=?')
      .get(f.target.id)?.designated_at;
    assert.equal(typeof designatedAt, 'string');
    assert.equal((await staffAdminManage(f.db, f.actor, f.input)).kind, 'ok');
    assert.equal(
      (await staffAdminManage(f.db, f.actor, { ...f.input, targetPersonId: f.other.id })).kind,
      'conflict',
    );
    const audit = f.db.raw
      .prepare('SELECT actor_id,target_id FROM staff_audits WHERE operation_id=?')
      .get(f.input.operationId);
    assert.equal(audit?.actor_id, f.actor.personId);
    assert.equal(audit.target_id, f.target.id);
    const revoke = {
      ...f.input,
      enabled: false,
      operationId: ulid(),
      expectedState: { updatedAt: f.target.updated_at, designatedAt: String(designatedAt) },
    };
    assert.equal((await staffAdminManage(f.db, f.actor, revoke)).kind, 'ok');
    assert.equal((await staffAdminManage(f.db, f.actor, revoke)).kind, 'ok');
    assert.equal(
      f.db.raw
        .prepare("SELECT count(*) AS n FROM staff_audits WHERE action='staff_admin.manage'")
        .get()?.n,
      2,
    );
    assert.ok(
      f.db.raw.prepare('SELECT 1 FROM staff_administrators WHERE person_id=?').get(f.admin.id),
    );
    assert.equal(
      f.db.raw.prepare('SELECT 1 FROM staff_administrators WHERE person_id=?').get(f.target.id),
      undefined,
    );
  } finally {
    f.db.raw.close();
  }
});

void test('a stale selected profile or designation cannot grant or remove access', async () => {
  const f = await fixture();
  try {
    assert.equal(
      (
        await staffAdminManage(f.db, f.actor, {
          ...f.input,
          expectedState: { updatedAt: '2000-01-01T00:00:00Z', designatedAt: null },
        })
      ).kind,
      'conflict',
    );
    f.db.raw
      .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
      .run(f.target.id, f.admin.id, '2026-01-01T00:00:00Z');
    assert.equal((await staffAdminManage(f.db, f.actor, f.input)).kind, 'conflict');
    assert.equal(
      (
        await staffAdminManage(f.db, f.actor, {
          ...f.input,
          enabled: false,
          expectedState: { updatedAt: f.target.updated_at, designatedAt: '2000-01-01T00:00:00Z' },
        })
      ).kind,
      'conflict',
    );
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM staff_audits').get()?.n, 0);
  } finally {
    f.db.raw.close();
  }
});

for (const change of [
  'authority',
  'membership',
  'workspace',
  'workspace_domain',
  'version',
  'designation',
] as const) {
  void test(`grant rechecks ${change} immediately before its atomic batch`, async () => {
    const f = await fixture();
    try {
      const raced: Db = {
        prepare: (sql) => f.db.prepare(sql),
        batch: async (statements) => {
          if (change === 'authority')
            f.db.raw
              .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
              .run(f.admin.id);
          if (change === 'membership')
            f.db.raw
              .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
              .run(f.target.id);
          if (change === 'workspace')
            f.db.raw
              .prepare(
                "UPDATE identities SET person_id=? WHERE platform='google_workspace' AND external_id='target-google'",
              )
              .run(f.other.id);
          if (change === 'workspace_domain')
            f.db.raw
              .prepare(
                "UPDATE identities SET external_email='outside@example.invalid' WHERE external_id='target-google'",
              )
              .run();
          if (change === 'version')
            f.db.raw
              .prepare("UPDATE people SET updated_at='2099-01-01T00:00:00Z' WHERE id=?")
              .run(f.target.id);
          if (change === 'designation')
            f.db.raw
              .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
              .run(f.target.id, f.admin.id, '2026-01-01T00:00:00Z');
          return await f.db.batch(statements);
        },
      };
      assert.equal(
        (await staffAdminManage(raced, f.actor, f.input)).kind,
        change === 'authority' ? 'forbidden' : 'conflict',
      );
      assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM staff_operations').get()?.n, 0);
      assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM staff_audits').get()?.n, 0);
      if (change !== 'designation')
        assert.equal(
          f.db.raw.prepare('SELECT 1 FROM staff_administrators WHERE person_id=?').get(f.target.id),
          undefined,
        );
    } finally {
      f.db.raw.close();
    }
  });
}

void test('the final active administrator cannot be revoked when former members retain old designations', async () => {
  const f = await fixture();
  try {
    f.db.raw
      .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
      .run(f.other.id, 'fixture', new Date().toISOString());
    f.db.raw
      .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
      .run(f.other.id);
    assert.equal(
      (
        await staffAdminManage(f.db, f.actor, {
          targetPersonId: f.admin.id,
          enabled: false,
          operationId: ulid(),
        })
      ).kind,
      'last_admin',
    );
    assert.ok(
      f.db.raw.prepare('SELECT 1 FROM staff_administrators WHERE person_id=?').get(f.admin.id),
    );
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM staff_operations').get()?.n, 0);
  } finally {
    f.db.raw.close();
  }
});

void test('loss of the backup membership before self-removal keeps the final active administrator', async () => {
  const f = await fixture();
  try {
    f.db.raw
      .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
      .run(f.other.id, 'fixture', new Date().toISOString());
    const raced: Db = {
      prepare: (sql) => f.db.prepare(sql),
      batch: async (statements) => {
        f.db.raw
          .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
          .run(f.other.id);
        return await f.db.batch(statements);
      },
    };
    assert.equal(
      (
        await staffAdminManage(raced, f.actor, {
          targetPersonId: f.admin.id,
          enabled: false,
          operationId: ulid(),
        })
      ).kind,
      'last_admin',
    );
    assert.ok(
      f.db.raw.prepare('SELECT 1 FROM staff_administrators WHERE person_id=?').get(f.admin.id),
    );
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM staff_operations').get()?.n, 0);
  } finally {
    f.db.raw.close();
  }
});

void test('an audit failure rolls back the designation and pending operation', async () => {
  const f = await fixture();
  try {
    f.db.raw.exec(
      "CREATE TRIGGER fail_admin_audit BEFORE INSERT ON staff_audits BEGIN SELECT RAISE(ABORT,'fixture_admin_audit_failure'); END",
    );
    await assert.rejects(staffAdminManage(f.db, f.actor, f.input), /fixture_admin_audit_failure/);
    assert.equal(
      f.db.raw.prepare('SELECT 1 FROM staff_administrators WHERE person_id=?').get(f.target.id),
      undefined,
    );
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM staff_operations').get()?.n, 0);
  } finally {
    f.db.raw.close();
  }
});

void test('portal grants require a connected LVBT Workspace identity independently of the membership email', async () => {
  const feature = await import('../src/staff-administrators');
  const f = await fixture();
  try {
    for (const email of [
      null,
      'target@example.invalid',
      'target@lasvegasfortransit.org.example.invalid',
    ]) {
      f.db.raw
        .prepare('UPDATE identities SET external_email=? WHERE external_id=?')
        .run(email, 'target-google');
      assert.equal(
        (await feature.staffAdministratorView(f.db, f.actor, f.target.id))?.has_workspace,
        0,
      );
      assert.equal(
        (await staffAdminManage(f.db, f.actor, { ...f.input, operationId: ulid() })).kind,
        'invalid',
      );
    }
    f.db.raw
      .prepare('UPDATE identities SET external_email=? WHERE external_id=?')
      .run('other-real-address@lasvegasfortransit.org', 'target-google');
    assert.equal((await staffAdminManage(f.db, f.actor, f.input)).kind, 'ok');
  } finally {
    f.db.raw.close();
  }
});
