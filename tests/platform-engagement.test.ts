import assert from 'node:assert/strict';
import test from 'node:test';
import { engagementCounts } from '../platform/storage/engagement';
import { PersonService } from '../platform/storage/person-service';
import { memoryDb, type MemoryDb } from './platform-db';

const NOW = new Date('2026-10-01T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

async function person(db: MemoryDb): Promise<string> {
  const { person } = await new PersonService(db).upsertFromSource({
    source: 'staff',
    fields: { email: 'ana@example.org' },
  });
  return person.id;
}

function eventCount(db: MemoryDb): number {
  return Number(db.raw.prepare('SELECT count(*) AS n FROM engagement_events').get()?.n);
}

void test('the same event from the same source is recorded once', async () => {
  const db = memoryDb();
  const people = new PersonService(db);
  const id = await person(db);
  const event = {
    type: 'attended' as const,
    occurredAt: daysAgo(3),
    source: 'luma',
    reference: 'evt_1',
  };
  const first = await people.recordEngagement(id, event);
  const second = await people.recordEngagement(id, event);
  assert.equal(second, first);
  assert.equal(eventCount(db), 1);
});

void test('an event entered late keeps when it happened and when it was recorded', async () => {
  const db = memoryDb();
  const id = await person(db);
  await new PersonService(db).recordEngagement(id, {
    type: 'attended',
    occurredAt: '2026-09-01T02:00:00Z',
    source: 'paper',
  });
  const row = db.raw
    .prepare("SELECT occurred_at, created_at FROM engagement_events WHERE type = 'attended'")
    .get() as { occurred_at: string; created_at: string };
  assert.equal(row.occurred_at, '2026-09-01T02:00:00Z');
  assert.ok(row.created_at > row.occurred_at);
});

void test('a single event cannot be changed or deleted', async () => {
  const db = memoryDb();
  const id = await person(db);
  await new PersonService(db).recordEngagement(id, {
    type: 'attended',
    occurredAt: daysAgo(1),
    source: 'paper',
  });
  assert.throws(() => db.raw.exec("UPDATE engagement_events SET source = 'x'"));
  assert.throws(() => db.raw.exec("DELETE FROM engagement_events WHERE type = 'attended'"));
});

void test('an unknown event type is refused', async () => {
  const db = memoryDb();
  const id = await person(db);
  await assert.rejects(
    new PersonService(db).recordEngagement(id, {
      type: 'party' as 'attended',
      occurredAt: daysAgo(1),
      source: 'paper',
    }),
  );
});

void test('the counts follow a known history, leaving out corrected events', async () => {
  const db = memoryDb();
  const people = new PersonService(db);
  const id = await person(db);
  const record = (type: Parameters<PersonService['recordEngagement']>[1]['type'], days: number) =>
    people.recordEngagement(id, { type, occurredAt: daysAgo(days), source: 'test' });

  // 24 events: subscribed, left, came back; 12 events attended, one of them
  // recorded against Ana by mistake and corrected; RSVPs and a donation.
  await record('subscribed', 400);
  await record('unsubscribed', 300);
  await record('subscribed', 200);
  const attendedDays = [180, 150, 120, 100, 95, 85, 60, 45, 30, 20, 10, 5];
  const attendedIds: string[] = [];
  for (const days of attendedDays) attendedIds.push(await record('attended', days));
  for (const days of [181, 151, 121, 61, 31, 11]) await record('rsvp', days);
  await record('donated', 40);
  await people.recordEngagement(id, {
    type: 'correction',
    occurredAt: daysAgo(4),
    source: 'staff',
    reference: attendedIds[3],
  });
  await record('role_changed', 2);

  const counts = await engagementCounts(db, id, NOW);
  assert.deepEqual(counts, {
    first_attended_at: daysAgo(180),
    last_attended_at: daysAgo(5),
    attended_last_90_days: 7,
    attended_total: 11,
    last_engaged_at: daysAgo(2),
    member_since: daysAgo(200),
  });
  const withCounts = await people.getPerson(id, { withCounts: true, now: NOW });
  assert.deepEqual(withCounts?.counts, counts);
});

void test('consent changes are logged, and leaving clears member_since', async () => {
  const db = memoryDb();
  const people = new PersonService(db);
  const id = await person(db);
  await people.recordConsent(id, {
    scope: 'newsletter',
    source: 'join_form',
    method: 'checkbox',
    wordingVersion: 'join-form-v1',
    givenAt: daysAgo(10),
  });
  assert.equal((await engagementCounts(db, id, NOW)).member_since, daysAgo(10));
  await people.withdrawConsent(id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: daysAgo(1),
  });
  assert.equal((await engagementCounts(db, id, NOW)).member_since, null);
  const types = db.raw.prepare('SELECT type FROM engagement_events ORDER BY occurred_at').all() as {
    type: string;
  }[];
  assert.deepEqual(
    types.map((row) => row.type),
    ['subscribed', 'unsubscribed'],
  );
});

void test('counts for a person with 1,000 events come back quickly', async () => {
  const db = memoryDb();
  const people = new PersonService(db);
  const id = await person(db);
  for (let index = 0; index < 1000; index += 1) {
    await people.recordEngagement(id, {
      type: index % 3 === 0 ? 'attended' : 'rsvp',
      occurredAt: daysAgo(index % 400),
      source: 'test',
    });
  }
  const started = performance.now();
  await engagementCounts(db, id, NOW);
  assert.ok(performance.now() - started < 50);
});

void test("a deleted person's events can be removed, with or without the person row", async () => {
  const db = memoryDb();
  const people = new PersonService(db);
  const id = await person(db);
  await people.recordEngagement(id, { type: 'attended', occurredAt: daysAgo(1), source: 'paper' });
  await people.deletePerson(id);
  db.raw.exec('PRAGMA foreign_keys = OFF');
  db.raw.prepare('DELETE FROM people WHERE id = ?').run(id);
  db.raw.prepare('DELETE FROM engagement_events WHERE person_id = ?').run(id);
  assert.equal(eventCount(db), 0);
});
