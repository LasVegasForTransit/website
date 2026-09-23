import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonService, type Source } from '../platform/storage/person-service';
import { memoryDb, type MemoryDb } from './platform-db';

async function existing(
  db: MemoryDb,
  fields: {
    email?: string;
    phone?: string;
    given_name?: string;
    family_name?: string;
    zip?: string;
  },
  verified = false,
): Promise<string> {
  const { person } = await new PersonService(db).upsertFromSource({
    source: 'staff',
    fields,
    emailVerified: verified,
  });
  return person.id;
}

function queue(db: MemoryDb) {
  return db.raw
    .prepare('SELECT candidate_person_id, existing_person_id, reason, details FROM review_queue')
    .all() as {
    candidate_person_id: string;
    existing_person_id: string;
    reason: string;
    details: string | null;
  }[];
}

function peopleCount(db: MemoryDb): number {
  return Number(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n);
}

void test('a verified incoming email links to the person with that email', async () => {
  const db = memoryDb();
  const anaId = await existing(db, { email: 'ana@example.org' });
  const { person, action } = await new PersonService(db).upsertFromSource({
    source: 'import',
    fields: { email: 'Ana@Example.org ' },
    emailVerified: true,
  });
  assert.equal(action, 'linked');
  assert.equal(person.id, anaId);
  assert.equal(queue(db).length, 0);
});

void test('the same unverified email from someone else becomes a new person for review', async () => {
  const db = memoryDb();
  const anaId = await existing(db, { email: 'ana@example.org' });
  const { person, action } = await new PersonService(db).upsertFromSource({
    source: 'paper',
    fields: { email: 'ana@example.org', given_name: 'Ana' },
  });
  assert.equal(action, 'created_and_queued');
  assert.notEqual(person.id, anaId);
  assert.equal(person.email, null);
  const [item] = queue(db);
  assert.ok(item);
  assert.deepEqual(
    { ...item, details: JSON.parse(item.details ?? 'null') as unknown },
    {
      candidate_person_id: person.id,
      existing_person_id: anaId,
      reason: 'same email, unverified',
      details: { email: 'ana@example.org' },
    },
  );
});

void test('a person typing their own email into a form links to their record', async () => {
  const db = memoryDb();
  for (const source of ['join_form', 'newsletter_box', 'external_form'] as Source[]) {
    const anaId = await existing(db, { email: `ana+${source}@example.org` });
    const { person, action } = await new PersonService(db).upsertFromSource({
      source,
      fields: { email: `ana+${source}@example.org` },
    });
    assert.equal(action, 'linked', source);
    assert.equal(person.id, anaId, source);
  }
  assert.equal(queue(db).length, 0);
});

void test('emails differing only by a dot are different people', async () => {
  const db = memoryDb();
  await existing(db, { email: 'ana@example.org' }, true);
  const { action } = await new PersonService(db).upsertFromSource({
    source: 'import',
    fields: { email: 'a.na@example.org' },
    emailVerified: true,
  });
  assert.equal(action, 'created');
  assert.equal(queue(db).length, 0);
});

void test('the same phone number queues the new person for review', async () => {
  const db = memoryDb();
  const benjiId = await existing(db, { email: 'benji@example.org', phone: '+17025550100' });
  const { person, action } = await new PersonService(db).upsertFromSource({
    source: 'join_form',
    fields: { email: 'ben@example.org', phone: '+17025550100' },
  });
  assert.equal(action, 'created_and_queued');
  assert.deepEqual(
    queue(db).map((item) => [item.candidate_person_id, item.existing_person_id, item.reason]),
    [[person.id, benjiId, 'same phone']],
  );
});

void test('the same full name and ZIP code queue the new person for review', async () => {
  const db = memoryDb();
  await existing(db, { given_name: 'Ana', family_name: 'Reyes', zip: '89104' });
  const { action } = await new PersonService(db).upsertFromSource({
    source: 'paper',
    fields: { given_name: 'ana', family_name: 'reyes', zip: '89104' },
  });
  assert.equal(action, 'created_and_queued');
  assert.equal(queue(db)[0]?.reason, 'same name and ZIP code');
});

void test('the same platform account processed twice is one person with one identity', async () => {
  const db = memoryDb();
  const people = new PersonService(db);
  const record = {
    source: 'beehiiv' as const,
    fields: { email: 'cam@example.org' },
    identity: { platform: 'beehiiv' as const, externalId: 'sub_1' },
  };
  const first = await people.upsertFromSource(record);
  const second = await people.upsertFromSource({
    ...record,
    fields: { email: 'cam.new@example.org' },
  });
  assert.equal(second.person.id, first.person.id);
  assert.equal(second.action, 'linked');
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM identities').get()?.n, 1);
  assert.equal(peopleCount(db), 1);
  assert.equal(queue(db).length, 0);
});

void test('a pair kept separate is not queued again for the same reason', async () => {
  const db = memoryDb();
  await existing(db, { email: 'dee@example.org', phone: '+17025550111' });
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'paper',
    fields: { phone: '+17025550111' },
  });
  db.raw.exec("UPDATE review_queue SET resolution = 'kept_separate', resolved_at = 'now'");
  const [item] = queue(db);
  assert.ok(item);
  // The same pair seen the other way round, as a later sync might, changes nothing.
  const { queueForReview } = await import('../platform/storage/matching');
  await queueForReview(
    db,
    item.existing_person_id,
    {
      kind: 'new',
      withholdEmail: false,
      review: [{ existingPersonId: person.id, reason: 'same phone' }],
      details: null,
    },
    'later',
  );
  assert.equal(queue(db).length, 1);
});
