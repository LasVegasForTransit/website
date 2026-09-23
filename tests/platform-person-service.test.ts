import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonService } from '../platform/storage/person-service';
import { memoryDb } from './platform-db';

const consent = {
  scope: 'newsletter' as const,
  source: 'join_form' as const,
  method: 'checkbox' as const,
  wordingVersion: 'join-form-v1',
};

void test('the schema has no column for a street address', () => {
  const db = memoryDb();
  const columns = db.raw.prepare('SELECT name FROM pragma_table_info(?)').all('people') as {
    name: string;
  }[];
  const names = columns.map((column) => column.name);
  assert.ok(names.includes('census_block'));
  assert.ok(!names.some((name) => /address|street/.test(name)));
});

void test('the migrations run once and seed membership rules version 1', () => {
  const db = memoryDb();
  const rule = db.raw.prepare('SELECT version, rule FROM membership_rules').get() as {
    version: number;
    rule: string;
  };
  assert.equal(rule.version, 1);
  const parsed = JSON.parse(rule.rule) as { member_if: { active_consent: string } };
  assert.equal(parsed.member_if.active_consent, 'newsletter');
});

void test('a newsletter consent makes a member and withdrawing it makes a former member', async () => {
  const people = new PersonService(memoryDb());
  const { person, action } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: ' Ana@Example.org ', given_name: 'Ana' },
    consent,
  });
  assert.equal(action, 'created');
  assert.equal(person.email, 'ana@example.org');
  assert.equal(person.membership_status, 'member');
  assert.equal(person.membership_rules_version, 1);

  const withdrawn = await people.withdrawConsent(person.id, {
    scope: 'newsletter',
    source: 'removal_link',
    withdrawnAt: new Date().toISOString(),
  });
  assert.equal(withdrawn?.membership_status, 'former_member');
});

void test('someone who never consented is not a member', async () => {
  const people = new PersonService(memoryDb());
  const { person } = await people.upsertFromSource({
    source: 'staff',
    fields: { email: 'bo@example.org' },
  });
  assert.equal(person.membership_status, 'not_member');
});

void test('joining again links to the same person and keeps what is known', async () => {
  const people = new PersonService(memoryDb());
  const first = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'ana@example.org', given_name: 'Ana' },
    consent,
  });
  const second = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'ANA@example.org', given_name: 'Someone else', zip: '89104' },
    consent,
  });
  assert.equal(second.action, 'linked');
  assert.equal(second.person.id, first.person.id);
  assert.equal(second.person.given_name, 'Ana');
  assert.equal(second.person.zip, '89104');
});

void test('a source cannot change a field it does not own', async () => {
  const warnings: string[] = [];
  const people = new PersonService(memoryDb(), (message) => warnings.push(message));
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'ana@example.org', given_name: 'Ana' },
  });
  const updated = await people.updateFields(person.id, {
    source: 'beehiiv',
    fields: { given_name: 'Overwritten' },
  });
  assert.equal(updated?.given_name, 'Ana');
  assert.ok(warnings.some((warning) => warning.includes('beehiiv may not change given_name')));
});

void test('every changed field records its source', async () => {
  const db = memoryDb();
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'ana@example.org', zip: '89104' },
  });
  const sources = db.raw
    .prepare('SELECT field, source FROM field_sources WHERE person_id = ? ORDER BY field')
    .all(person.id);
  assert.deepEqual(
    sources.map((row) => ({ ...row })),
    [
      { field: 'email', source: 'join_form' },
      { field: 'zip', source: 'join_form' },
    ],
  );
});

void test('deleting a person clears their personal fields at once and hides them', async () => {
  const db = memoryDb();
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'ana@example.org', given_name: 'Ana', phone: '+17025550123', zip: '89104' },
  });
  await people.deletePerson(person.id);
  const row = db.raw.prepare('SELECT * FROM people WHERE id = ?').get(person.id) as Record<
    string,
    unknown
  >;
  for (const field of ['given_name', 'email', 'phone', 'zip', 'census_block']) {
    assert.equal(row[field], null, field);
  }
  assert.ok(row.deleted_at);
  assert.equal(await people.getPerson(person.id), null);
  assert.deepEqual((await people.findPeople({ limit: 10 })).people, []);
});

void test('engagement events cannot be changed', async () => {
  const db = memoryDb();
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'ana@example.org' },
  });
  const id = await people.recordEngagement(person.id, {
    type: 'joined',
    occurredAt: new Date().toISOString(),
    source: 'join_form',
  });
  assert.throws(() =>
    db.raw.prepare("UPDATE engagement_events SET type = 'edited' WHERE id = ?").run(id),
  );
});

void test('a region from a better source replaces one from a weaker source, not the reverse', async () => {
  const people = new PersonService(memoryDb());
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'ana@example.org' },
  });
  assert.equal(await people.setRegion(person.id, 'summerlin', 'member_choice'), true);
  assert.equal(await people.setRegion(person.id, 'east_las_vegas', 'zip'), false);
  assert.equal(await people.setRegion(person.id, 'east_las_vegas', 'address'), true);
  assert.equal((await people.getPerson(person.id))?.region_id, 'east_las_vegas');
});

void test('findPeople filters by region and pages with a cursor', async () => {
  const people = new PersonService(memoryDb());
  for (const email of ['a@example.org', 'b@example.org', 'c@example.org']) {
    const { person } = await people.upsertFromSource({ source: 'join_form', fields: { email } });
    await people.setRegion(person.id, 'downtown', 'member_choice');
  }
  const first = await people.findPeople({ regionId: 'downtown', limit: 2 });
  assert.equal(first.people.length, 2);
  assert.ok(first.nextCursor);
  const second = await people.findPeople({
    regionId: 'downtown',
    limit: 2,
    cursor: first.nextCursor,
  });
  assert.equal(second.people.length, 1);
  assert.equal(second.nextCursor, null);
});
