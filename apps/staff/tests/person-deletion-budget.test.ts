import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { queryBudget } from '@lasvegasfortransit/platform-storage/query-budget';
import { issueFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import { loadActor } from '@lasvegasfortransit/platform-storage/staff-roles';
import { staffDeletionView } from '@lasvegasfortransit/platform-storage/staff-deletion';
import {
  createWorkspaceSession,
  linkWorkspaceIdentity,
} from '@lasvegasfortransit/platform-storage/workspace-link';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { resolveStaffContext } from '../src/lib/context';
import { submitPersonDeletion } from '../src/lib/person-deletion';

type Mode =
  'get' | 'normal' | 'stale' | 'race_stale' | 'race_authority' | 'race_owner' | 'race_email';
async function fixture() {
  const db = memoryDb(),
    people = new PersonService(db);
  const member = async (name: string) =>
    (
      await people.upsertFromSource({
        source: 'join_form',
        fields: { email: `${name}@example.invalid` },
        consent: {
          scope: 'newsletter',
          source: 'join_form',
          method: 'checkbox',
          wordingVersion: 'fixture',
        },
      })
    ).person;
  const admin = await member('budget-admin'),
    target = await member('budget-target'),
    other = await member('budget-other');
  db.raw
    .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
    .run(admin.id, 'fixture', new Date().toISOString());
  await people.linkIdentity(target.id, {
    platform: 'beehiiv',
    externalId: 'budget-newsletter',
    externalEmail: 'original-account@example.invalid',
    linkMethod: 'self_linked',
  });
  const workspace = {
    subject: 'budget-admin',
    email: 'budget-admin@lasvegasfortransit.org',
    givenName: null,
    familyName: null,
  };
  await linkWorkspaceIdentity(db, {
    workspace,
    personId: admin.id,
    method: 'self_linked',
    operationId: 'budget-admin-link',
  });
  const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'budget-fixture-only' };
  const session = await createWorkspaceSession(env, workspace);
  const actor = await loadActor(db, admin.id);
  assert.ok(session && actor);
  const selected = await people.getPerson(target.id);
  assert.ok(selected);
  const token = await issueFormToken(db, actor, `person:delete:${target.id}`);
  return { db, people, admin, target: selected, other, workspace, env, session, token };
}
function race(f: Awaited<ReturnType<typeof fixture>>, mode: Mode) {
  // These writes model another invocation and are deliberately outside this request's meter.
  if (mode === 'race_stale')
    f.db.raw
      .prepare("UPDATE people SET updated_at='2099-01-01T00:00:00Z' WHERE id=?")
      .run(f.target.id);
  if (mode === 'race_authority')
    f.db.raw
      .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
      .run(f.admin.id);
  if (mode === 'race_owner')
    f.db.raw
      .prepare(
        "UPDATE identities SET person_id=? WHERE platform='beehiiv' AND external_id='budget-newsletter'",
      )
      .run(f.other.id);
  if (mode === 'race_email')
    f.db.raw
      .prepare(
        "UPDATE identities SET external_email='changed-account@example.invalid' WHERE platform='beehiiv' AND external_id='budget-newsletter'",
      )
      .run();
}
async function invocation(f: Awaited<ReturnType<typeof fixture>>, mode: Mode) {
  const budget = queryBudget(f.db, 50);
  let batches = 0;
  const counted: Db = {
    prepare: (sql) => budget.db.prepare(sql),
    batch: async (statements) => {
      if (batches++ === 0) race(f, mode);
      return await budget.db.batch(statements);
    },
  };
  const request = new Request(
    `https://staff.lasvegasfortransit.org/people/${f.target.id}/delete/`,
    {
      method: mode === 'get' ? 'GET' : 'POST',
      headers: {
        Origin: 'https://staff.lasvegasfortransit.org',
        Cookie: `__Host-lvbt_session=${f.session.token}`,
      },
      ...(mode === 'get'
        ? {}
        : {
            body: new URLSearchParams({
              action: 'delete',
              token: f.token,
              operation_id: '01K00000000000000000000000',
              expected_updated_at: f.target.updated_at,
            }),
          }),
    },
  );
  if (mode === 'stale') race(f, 'race_stale');
  // This is the actual D1-bearing middleware path: Workspace session and current actor resolution.
  // Access assertion verification uses no D1 statements.
  const staff = await resolveStaffContext(
    request,
    { ...f.env, PLATFORM_DB: counted },
    { email: f.workspace.email, subject: 'budget-access-subject' },
  );
  assert.ok(!(staff instanceof Response));
  const result = mode === 'get' ? null : await submitPersonDeletion(request, staff, f.target.id);
  if (result instanceof Response)
    return { status: result.status, queries: budget.queries, batches };
  const person = await staffDeletionView(counted, staff.actor, f.target.id);
  assert.ok(person);
  if (!result) await issueFormToken(counted, staff.actor, `person:delete:${f.target.id}`);
  // The confirmation/error template reads the selected person and its StaffLayout issues a sign-out token.
  // Include both in this same meter; budgeting only the mutation would miss the invocation limit.
  await issueFormToken(counted, staff.actor, 'sign-out');
  return { status: result?.status ?? 200, queries: budget.queries, batches };
}

for (const [mode, status] of [
  ['get', 200],
  ['normal', 303],
  ['stale', 409],
  ['race_stale', 409],
  ['race_authority', 403],
  ['race_owner', 409],
  ['race_email', 409],
] as const) {
  void test(`whole staff deletion invocation stays within fifty statements: ${mode}`, async () => {
    const f = await fixture();
    try {
      const result = await invocation(f, mode);
      assert.equal(result.status, status);
      assert.ok(result.queries <= 50, `${mode}: ${result.queries} statements`);
      const erased = f.db.raw
        .prepare('SELECT erased_at FROM people WHERE id=?')
        .get(f.target.id)?.erased_at;
      if (mode === 'normal') assert.ok(erased);
      else {
        assert.equal(erased, null);
        for (const table of [
          'person_deletion_log',
          'newsletter_address_tombstones',
          'newsletter_erasure_checks',
          'person_erasure_scope',
        ])
          assert.equal(f.db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0, table);
      }
      if (mode.startsWith('race_'))
        assert.equal(
          result.batches,
          1,
          'staff confirmation never silently retries changed ownership',
        );
      assert.equal((await f.people.getPerson(f.other.id))?.email, 'budget-other@example.invalid');
      if (mode === 'race_owner') {
        assert.equal(
          f.db.raw
            .prepare("SELECT person_id FROM identities WHERE external_id='budget-newsletter'")
            .get()?.person_id,
          f.other.id,
        );
        assert.equal(
          (await f.people.getPerson(f.target.id))?.updated_at,
          f.target.updated_at,
          'this race changes ownership without changing the selected record version',
        );
      }
      console.log(JSON.stringify({ mode, ...result }));
    } finally {
      f.db.raw.close();
    }
  });
}
