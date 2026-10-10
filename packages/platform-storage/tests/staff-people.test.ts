import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonService } from '../src/person-service';
import { bootstrapStaffAdmin, loadActor } from '../src/staff-roles';
import { CommitteeService } from '../src/committees';
import { linkWorkspaceIdentity } from '../src/workspace-link';
import { memoryDb } from './support/db';
const consent = {
  scope: 'newsletter' as const,
  source: 'join_form' as const,
  method: 'checkbox' as const,
  wordingVersion: 'join-form-v1',
};
async function fixture() {
  const loaded = await import('../src/staff-people').catch(() => null);
  assert.ok(loaded, 'staff need scoped roster search and authorized profiles');
  const db = memoryDb();
  const people = new PersonService(db);
  const member = async (
    email: string,
    fields: { given_name?: string; family_name?: string; zip?: string } = {},
  ) =>
    (await people.upsertFromSource({ source: 'join_form', fields: { email, ...fields }, consent }))
      .person;
  const admin = await member('admin@example.org');
  await linkWorkspaceIdentity(db, {
    workspace: {
      subject: 'admin-google',
      email: 'admin@lasvegasfortransit.org',
      givenName: null,
      familyName: null,
    },
    personId: admin.id,
    method: 'self_linked',
    operationId: 'link',
  });
  await bootstrapStaffAdmin(db, {
    presidentPersonId: admin.id,
    workspaceSubject: 'admin-google',
    performedBy: 'fixture-maintainer',
    operationId: 'bootstrap',
  });
  const lead = await member('lead@example.org');
  const committees = new CommitteeService(db);
  await committees.assign({
    personId: lead.id,
    committeeId: 'events',
    role: 'lead',
    actorId: admin.id,
    operationId: 'lead',
  });
  const adminActor = await loadActor(db, admin.id);
  const leadActor = await loadActor(db, lead.id);
  assert.ok(adminActor);
  assert.ok(leadActor);
  return { ...loaded, db, people, member, admin, lead, adminActor, leadActor, committees };
}
void test('rosters page in displayed name order with ties and unnamed email records', async () => {
  const { db, member, adminActor, searchStaffPeople } = await fixture();
  const z = await member('sort-z@example.org', { given_name: 'Zelda' });
  const a = await member('sort-a@example.org', { given_name: 'Ana' });
  const duplicate = await member('sort-duplicate@example.org', { given_name: 'ana' });
  const unnamed = await member('sort-fallback@example.org');
  const unicode = await member('sort-unicode@example.org', { given_name: '张' });
  const nextUnicode = await member('sort-unicode-next@example.org', { given_name: '李' });
  const expected = [a.id, duplicate.id].sort().concat(unnamed.id, z.id, unicode.id, nextUnicode.id);
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await searchStaffPeople(db, adminActor, {
      text: 'sort-',
      limit: 1,
      ...(cursor ? { cursor } : {}),
    });
    ids.push(...page.items.map((person) => person.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.deepEqual(ids, expected);
  db.raw.close();
});
void test('roster search combines filters, includes null names, escapes literal wildcards, and excludes deleted people', async () => {
  const { db, people, member, adminActor, searchStaffPeople, committees, admin } = await fixture();
  const named = await member('named@example.org', {
    given_name: 'Ana',
    family_name: 'Same',
    zip: '89104',
  });
  const literal = await member('literal%_@example.org', { zip: '89104' });
  await member('ordinary@example.org', { given_name: 'Ana', zip: '89101' });
  const removed = await member('removed@example.org', { given_name: 'Ana', zip: '89104' });
  db.raw
    .prepare('UPDATE people SET deleted_at=? WHERE id=?')
    .run(new Date().toISOString(), removed.id);
  await committees.assign({
    personId: named.id,
    committeeId: 'events',
    role: 'member',
    actorId: admin.id,
    operationId: 'named-assignment',
  });
  const filtered = await searchStaffPeople(db, adminActor, {
    text: 'Ana',
    zip: '89104',
    membershipStatus: 'member',
    committeeId: 'events',
  });
  assert.deepEqual(
    filtered.items.map((p) => p.id),
    [named.id],
  );
  assert.deepEqual(
    (await searchStaffPeople(db, adminActor, { text: '%_' })).items.map((p) => p.id),
    [literal.id],
  );
  assert.deepEqual(
    (await searchStaffPeople(db, adminActor, { text: 'literal' })).items.map((p) => p.id),
    [literal.id],
  );
  assert.equal(
    (await searchStaffPeople(db, adminActor, { email: ' NAMED@EXAMPLE.ORG ' })).items[0]?.id,
    named.id,
  );
  await people.withdrawConsent(named.id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: new Date().toISOString(),
  });
  assert.equal(
    (await searchStaffPeople(db, adminActor, { membershipStatus: 'former_member' })).items[0]?.id,
    named.id,
  );
  db.raw.close();
});
void test('SQL scopes precede pagination; stale actors and changed assignments cannot expose unrelated records', async () => {
  const {
    db,
    member,
    adminActor,
    leadActor,
    searchStaffPeople,
    getStaffPerson,
    committees,
    admin,
    lead,
  } = await fixture();
  const outside = await member('outside@example.org', { given_name: 'Same' });
  const inside = [];
  for (let i = 0; i < 4; i++) {
    const person = await member(`inside${i}@example.org`, { given_name: 'Same' });
    inside.push(person);
    await committees.assign({
      personId: person.id,
      committeeId: 'events',
      role: 'member',
      actorId: admin.id,
      operationId: `inside-${i}`,
    });
  }
  const ids = [];
  let cursor: string | undefined;
  do {
    const page = await searchStaffPeople(db, leadActor, {
      text: 'Same',
      limit: 2,
      ...(cursor ? { cursor } : {}),
    });
    ids.push(...page.items.map((p) => p.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.deepEqual(new Set(ids), new Set(inside.map((p) => p.id)));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(await getStaffPerson(db, leadActor, outside.id), null);
  assert.ok(await getStaffPerson(db, adminActor, outside.id));
  const assignment = db.raw
    .prepare("SELECT id FROM committee_assignments WHERE person_id=? AND role='lead'")
    .get(lead.id);
  assert.ok(assignment && typeof assignment.id === 'string');
  await committees.endAssignment(assignment.id, 'stepped_back', admin.id, 'revoke-lead');
  await assert.rejects(searchStaffPeople(db, leadActor, {}), {
    message: "You don't have access to this",
  });
  const firstInside = inside[0];
  assert.ok(firstInside);
  assert.equal(await getStaffPerson(db, leadActor, firstInside.id), null);
  assert.equal(
    db.raw
      .prepare(
        "SELECT count(*) AS n FROM staff_audits WHERE action='permission.denied' AND (target_id IS NOT NULL OR details IS NOT NULL)",
      )
      .get()?.n,
    0,
  );
  db.raw.close();
});
void test('profiles include consent and assignment history, hide donation data from leads, and page engagement without duplication', async () => {
  const { db, member, leadActor, adminActor, getStaffPerson, committees, admin, people } =
    await fixture();
  const person = await member('history@example.org');
  const assigned = await committees.assign({
    personId: person.id,
    committeeId: 'events',
    role: 'member',
    actorId: admin.id,
    operationId: 'history-assignment',
  });
  assert.equal(assigned.kind, 'ok');
  await committees.assign({
    personId: person.id,
    committeeId: 'advocacy',
    role: 'member',
    actorId: admin.id,
    operationId: 'old-assignment',
  });
  await people.linkIdentity(person.id, {
    platform: 'givebutter',
    externalId: 'private-donor-id',
    linkMethod: 'staff_confirmed',
  });
  const donation = await people.recordEngagement(person.id, {
    type: 'donated',
    occurredAt: '2026-10-01T12:00:00Z',
    source: 'givebutter',
    reference: 'private-donation',
    details: { amount: 4321 },
  });
  await people.recordEngagement(person.id, {
    type: 'correction',
    occurredAt: '2026-10-02T12:00:00Z',
    source: 'staff',
    reference: donation,
    details: { amount: 4321 },
  });
  for (let i = 0; i < 55; i++)
    await people.recordEngagement(person.id, {
      type: 'attended',
      occurredAt: '2026-10-03T12:00:00Z',
      source: 'fixture',
      reference: `attendance-${i}`,
    });
  const first = await getStaffPerson(db, leadActor, person.id);
  assert.ok(first);
  assert.equal(first.events.items.length, 50);
  assert.ok(first.events.nextCursor);
  assert.equal(first.consents.length, 1);
  assert.equal(first.assignments.length, 2);
  const second = await getStaffPerson(db, leadActor, person.id, {
    cursor: first.events.nextCursor,
  });
  assert.ok(second);
  const visible = [...first.events.items, ...second.events.items];
  assert.equal(new Set(visible.map((e) => e.id)).size, visible.length);
  assert.equal(JSON.stringify([first, second]).includes('4321'), false);
  assert.equal(JSON.stringify([first, second]).includes('private-donor-id'), false);
  const full = await getStaffPerson(db, adminActor, person.id, { cursor: first.events.nextCursor });
  assert.ok(full);
  assert.equal(JSON.stringify(full).includes('4321'), true);
  const views = db.raw.prepare('SELECT actor_id,person_id FROM person_views').all();
  assert.ok(
    views.some((row) => row.actor_id === leadActor.personId && row.person_id === person.id),
  );
  await committees.endAssignment(assigned.value.id, 'stepped_back', admin.id, 'end-history');
  assert.equal(await getStaffPerson(db, leadActor, person.id), null);
  db.raw.close();
});
void test('invalid cursors are rejected and merged IDs redirect only to an authorized survivor', async () => {
  const { db, member, adminActor, leadActor, searchStaffPeople, getStaffPerson } = await fixture();
  await assert.rejects(searchStaffPeople(db, adminActor, { cursor: 'not-a-person-id' }));
  const survivor = await member('survivor@example.org');
  const merged = await member('merged@example.org');
  db.raw
    .prepare('UPDATE people SET deleted_at=? WHERE id=?')
    .run(new Date().toISOString(), merged.id);
  db.raw
    .prepare(
      "INSERT INTO merges(id,surviving_person_id,merged_person_id,merged_at,merged_by,moved_rows,created_at,updated_at) VALUES ('merge',?,?,?,?,'[]',?,?)",
    )
    .run(survivor.id, merged.id, 'stamp', adminActor.personId, 'stamp', 'stamp');
  assert.equal((await getStaffPerson(db, adminActor, merged.id))?.person.id, survivor.id);
  assert.equal(await getStaffPerson(db, leadActor, merged.id), null);
  await assert.rejects(getStaffPerson(db, adminActor, survivor.id, { cursor: 'untrusted' }));
  db.raw.close();
});

void test('a designation revoked after actor loading is rechecked inside the search SQL', async () => {
  const { db, adminActor, searchStaffPeople } = await fixture();
  let revoked = false;
  const guarded = {
    ...db,
    prepare: (sql: string) => {
      if (sql.startsWith('SELECT p.id,') && !revoked) {
        revoked = true;
        db.raw.exec('DROP TRIGGER staff_admin_keep_last; DELETE FROM staff_administrators;');
      }
      return db.prepare(sql);
    },
  };
  assert.deepEqual((await searchStaffPeople(guarded, adminActor, {})).items, []);
  assert.equal(revoked, true);
  db.raw.close();
});
