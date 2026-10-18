import assert from 'node:assert/strict';
import test from 'node:test';
import { hashWithSecret } from '@lasvegasfortransit/platform-core/signing';
import { createSession } from '../src/auth';
import { correctPerson } from '../src/corrections';
import type { Db } from '../src/db';
import { collectPersonExport } from '../src/person-export';
import { PersonService } from '../src/person-service';
import { bootstrapStaffAdmin, loadActor } from '../src/staff-roles';
import { createWorkspaceSession, linkWorkspaceIdentity } from '../src/workspace-link';
import { memoryDb } from './support/db';

async function fixture() {
  const db = memoryDb();
  const people = new PersonService(db);
  async function member(email: string, givenName: string) {
    return (
      await people.upsertFromSource({
        source: 'join_form',
        fields: { email, given_name: givenName },
        consent: {
          scope: 'newsletter',
          source: 'join_form',
          method: 'checkbox',
          wordingVersion: 'fixture',
        },
      })
    ).person;
  }
  const admin = await member('export-admin@example.invalid', 'Administrator');
  const subject = await member('export-subject@example.invalid', 'Original');
  const other = await member('export-other@example.invalid', 'Unrelated');
  const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'correction-export-fixture' };
  const workspace = {
    subject: 'correction-export-google',
    email: 'admin@lasvegasfortransit.org',
    givenName: null,
    familyName: null,
  };
  await linkWorkspaceIdentity(db, {
    workspace,
    personId: admin.id,
    method: 'self_linked',
    operationId: 'link',
  });
  await bootstrapStaffAdmin(db, {
    presidentPersonId: admin.id,
    workspaceSubject: workspace.subject,
    performedBy: 'fixture',
    operationId: 'bootstrap',
  });
  db.raw
    .prepare(
      'INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES(?,?,?)',
    )
    .run(other.id, admin.id, new Date().toISOString());
  const actor = await loadActor(db, admin.id);
  assert.ok(actor);
  for (const [person, reason, operationId] of [
    [subject, 'Member confirmed their name and phone.', 'subject-correction'],
    [other, 'UNRELATED-PRIVATE-REASON', 'other-correction'],
  ] as const) {
    assert.equal(
      (
        await correctPerson(db, actor, person.id, {
          fields: { given_name: 'Corrected', phone: '7025550100' },
          reason,
          operationId,
        })
      ).kind,
      'ok',
    );
  }
  const staffSession = await createWorkspaceSession(env, workspace);
  assert.ok(staffSession);
  const administrator = {
    kind: 'administrator' as const,
    personId: admin.id,
    sessionHash: await hashWithSecret(env.LVBT_SIGN_IN_SECRET, `session:${staffSession.token}`),
    workspaceEmail: workspace.email,
  };
  const memberSession = await createSession(env, subject.id, 'member');
  const memberAuthority = {
    kind: 'member' as const,
    personId: subject.id,
    sessionHash: await hashWithSecret(env.LVBT_SIGN_IN_SECRET, `session:${memberSession.token}`),
  };
  return { db, admin, subject, other, actor, administrator, memberAuthority };
}

void test('only explicit administrator exports include the selected member’s attributed correction values', async (context) => {
  const f = await fixture();
  context.after(() => f.db.raw.close());
  const exported = await collectPersonExport(f.db, f.subject.id, f.administrator);
  assert.ok(exported);
  const saved = f.db.raw
    .prepare('SELECT corrected_at FROM person_corrections WHERE person_id=?')
    .get(f.subject.id);
  assert.deepEqual(exported.profile_corrections, [
    {
      corrected_at: saved?.corrected_at,
      changed_fields: ['given_name', 'phone'],
      changed_by: { id: f.admin.id, name: 'Administrator' },
      reason: 'Member confirmed their name and phone.',
      changes: [
        { field: 'given_name', before: 'Original', after: 'Corrected' },
        { field: 'phone', before: null, after: '+17025550100' },
      ],
    },
  ]);
  for (const forbidden of [
    f.other.id,
    f.other.email,
    'UNRELATED-PRIVATE-REASON',
    'beforeSource',
    'operation_id',
  ]) {
    assert.ok(forbidden);
    assert.equal(JSON.stringify(exported).includes(forbidden), false, forbidden);
  }
  const personal = await collectPersonExport(f.db, f.subject.id, f.memberAuthority);
  assert.ok(personal);
  assert.deepEqual(personal.profile_corrections, [
    { corrected_at: saved?.corrected_at, changed_fields: ['given_name', 'phone'] },
  ]);
  for (const forbidden of [
    f.admin.id,
    'Member confirmed their name and phone.',
    'changed_by',
    '"before":',
  ])
    assert.equal(JSON.stringify(personal).includes(forbidden), false, forbidden);
});

void test('a staff administrator’s self-service export keeps the member privacy shape', async (context) => {
  const f = await fixture();
  context.after(() => f.db.raw.close());
  assert.equal(
    (
      await correctPerson(f.db, f.actor, f.admin.id, {
        fields: { phone: '7025550101' },
        reason: 'PRIVATE-SELF-CORRECTION',
        operationId: 'self-correction',
      })
    ).kind,
    'ok',
  );
  const personal = await collectPersonExport(f.db, f.admin.id, {
    kind: 'member',
    personId: f.admin.id,
    sessionHash: f.administrator.sessionHash,
  });
  assert.ok(personal);
  const corrections = personal.profile_corrections as Array<Record<string, unknown>>;
  assert.deepEqual(corrections.map(Object.keys), [['corrected_at', 'changed_fields']]);
  assert.equal(JSON.stringify(personal).includes('PRIVATE-SELF-CORRECTION'), false);
});

void test('administrator correction exports are withheld if designation, identity or session is revoked during collection', async () => {
  for (const change of ['designation', 'identity', 'session']) {
    const f = await fixture();
    try {
      const racing: Db = {
        prepare: (sql) => f.db.prepare(sql),
        batch: async (statements) => {
          const snapshot = await f.db.batch(statements);
          if (change === 'designation')
            f.db.raw.prepare('DELETE FROM staff_administrators WHERE person_id=?').run(f.admin.id);
          if (change === 'identity')
            f.db.raw
              .prepare("DELETE FROM identities WHERE person_id=? AND platform='google_workspace'")
              .run(f.admin.id);
          if (change === 'session')
            f.db.raw.prepare('DELETE FROM sessions WHERE person_id=?').run(f.admin.id);
          return snapshot;
        },
      };
      assert.equal(await collectPersonExport(racing, f.subject.id, f.administrator), null, change);
      assert.equal(
        f.db.raw
          .prepare("SELECT count(*) AS n FROM staff_audits WHERE action='person.export'")
          .get()?.n,
        0,
      );
    } finally {
      f.db.raw.close();
    }
  }
});
