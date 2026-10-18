import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonService } from '../src/person-service';
import { CommitteeService } from '../src/committees';
import { memoryDb } from './support/db';

async function fixture() {
  const loaded = await import('../src/staff-participation').catch(() => null);
  assert.ok(loaded, 'profiles need participation independent of the mixed activity page');
  const db = memoryDb();
  const people = new PersonService(db);
  const member = async (email: string) =>
    (
      await people.upsertFromSource({
        source: 'join_form',
        fields: { email },
        consent: {
          scope: 'newsletter',
          source: 'join_form',
          method: 'checkbox',
          wordingVersion: 'fixture',
        },
      })
    ).person;
  const admin = await member('admin@example.invalid');
  db.raw
    .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
    .run(admin.id, 'fixture', '2026-10-01T00:00:00Z');
  const person = await member('participant@example.invalid');
  return { ...loaded, db, people, member, admin, person };
}

void test('participation finds older named attendance behind newer unrelated history and excludes corrections', async () => {
  const f = await fixture();
  try {
    await f.people.recordEngagement(f.person.id, {
      type: 'attended',
      source: 'paper',
      reference: 'social',
      occurredAt: '2026-08-01T12:00:00Z',
      details: {
        eventName: 'Summer social',
        email: 'private@example.invalid',
        note: 'Private note',
      },
    });
    const mistake = await f.people.recordEngagement(f.person.id, {
      type: 'attended',
      source: 'paper',
      reference: 'mistake',
      occurredAt: '2026-08-02T12:00:00Z',
      details: { eventName: 'Mistaken event' },
    });
    await f.people.recordEngagement(f.person.id, {
      type: 'correction',
      source: 'staff',
      reference: mistake,
      occurredAt: '2026-08-03T12:00:00Z',
    });
    await f.people.recordEngagement(f.person.id, {
      type: 'rsvp',
      source: 'import',
      occurredAt: '2026-09-01T12:00:00Z',
      details: { eventName: 'Autumn meeting' },
    });
    for (let i = 0; i < 55; i++)
      await f.people.recordEngagement(f.person.id, {
        type: 'form_response',
        source: 'fixture',
        occurredAt: '2026-10-01T12:00:00Z',
      });
    const result = await f.staffParticipation(f.db, f.admin.id, f.person.id);
    assert.ok(result);
    assert.equal(result.attendedTotal, 1);
    assert.equal(result.rsvpTotal, 1);
    assert.deepEqual(
      result.items.map(({ type, eventName, occurredAt }) => ({ type, eventName, occurredAt })),
      [
        { type: 'rsvp', eventName: 'Autumn meeting', occurredAt: '2026-09-01T12:00:00Z' },
        { type: 'attended', eventName: 'Summer social', occurredAt: '2026-08-01T12:00:00Z' },
      ],
    );
    assert.doesNotMatch(JSON.stringify(result), /private|Private|Mistaken|form_response/);
  } finally {
    f.db.raw.close();
  }
});

void test('participation bounds recent records while totals include every matching record and names stay optional', async () => {
  const f = await fixture();
  try {
    for (let i = 1; i <= 12; i++)
      await f.people.recordEngagement(f.person.id, {
        type: 'attended',
        source: 'fixture',
        reference: String(i),
        occurredAt: `2026-09-${String(i).padStart(2, '0')}T12:00:00Z`,
        details: i === 12 ? { eventName: { unsafe: 'not a label' } } : { eventName: `Event ${i}` },
      });
    const result = await f.staffParticipation(f.db, f.admin.id, f.person.id);
    assert.ok(result);
    assert.equal(result.attendedTotal, 12);
    assert.equal(result.items.length, 10);
    assert.equal(result.items[0]?.eventName, null);
    assert.equal(result.items.at(-1)?.eventName, 'Event 3');
    const empty = await f.staffParticipation(f.db, f.admin.id, f.admin.id);
    assert.deepEqual(empty, { attendedTotal: 0, rsvpTotal: 0, items: [] });
  } finally {
    f.db.raw.close();
  }
});

void test('participation rechecks person scope for committee leads, ended assignments and erased people', async () => {
  const f = await fixture();
  try {
    const lead = await f.member('lead@example.invalid');
    const other = await f.member('unrelated@example.invalid');
    const committees = new CommitteeService(f.db);
    for (const [personId, role] of [
      [lead.id, 'lead'],
      [f.person.id, 'member'],
    ] as const) {
      assert.equal(
        (
          await committees.assign({
            personId,
            committeeId: 'events',
            role,
            actorId: f.admin.id,
            operationId: `assign-${personId}`,
          })
        ).kind,
        'ok',
      );
    }
    await f.people.recordEngagement(f.person.id, {
      type: 'attended',
      source: 'paper',
      occurredAt: '2026-09-01T12:00:00Z',
      details: { eventName: 'Scoped event' },
    });
    assert.equal((await f.staffParticipation(f.db, lead.id, f.person.id))?.attendedTotal, 1);
    assert.equal(await f.staffParticipation(f.db, lead.id, other.id), null);
    assert.equal(await f.staffParticipation(f.db, other.id, f.person.id), null);
    f.db.raw
      .prepare("UPDATE committee_assignments SET ended_at=?,end_reason='removed' WHERE person_id=?")
      .run('2026-10-01T00:00:00Z', lead.id);
    assert.equal(await f.staffParticipation(f.db, lead.id, f.person.id), null);
    await f.people.deletePerson(f.person.id);
    assert.equal(await f.staffParticipation(f.db, f.admin.id, f.person.id), null);
  } finally {
    f.db.raw.close();
  }
});
