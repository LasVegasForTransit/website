import assert from 'node:assert/strict';
import { memoryDb } from './db';
import { PersonService } from '../../src/person-service';

export const observedAt = '2026-10-14T10:00:00.000Z';
export async function membershipRollFixture() {
  const db = memoryDb(),
    people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'staff',
    fields: { email: 'current@example.invalid' },
  });
  assert.ok(person.email);
  await people.linkIdentity(person.id, {
    platform: 'beehiiv',
    externalId: 'sub_current_roll',
    externalEmail: person.email,
    linkMethod: 'created_by_platform',
  });
  const input = {
    personId: person.id,
    externalId: 'sub_current_roll',
    status: 'active' as const,
    observedAt,
  };
  const roll = await import('../../src/membership-roll').catch(() => null);
  assert.ok(roll, 'Current membership must be recognized independently of missing consent history');
  return { db, people, person, input, roll };
}
