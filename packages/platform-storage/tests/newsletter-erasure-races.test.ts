import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { PersonService } from '../src/person-service';
import type { Db } from '../src/db';

void test('repeated address changes stop erasure safely after bounded retries', async () => {
  const db = memoryDb();
  const people = new PersonService(db);
  try {
    const { person } = await people.upsertFromSource({
      source: 'join_form',
      fields: { email: 'erasure-race@example.invalid' },
    });
    let attempts = 0;
    const raced: Db = {
      prepare: (sql) => db.prepare(sql),
      batch: async (statements) => {
        attempts++;
        await people.updateFields(person.id, {
          source: 'member',
          fields: { email: `erasure-race-${attempts}@example.invalid` },
        });
        return db.batch(statements);
      },
    };
    await assert.rejects(new PersonService(raced).deletePerson(person.id), /valid_snapshot/);
    assert.equal(attempts, 3);
    assert.equal((await people.getPerson(person.id))?.email, 'erasure-race-3@example.invalid');
    for (const table of [
      'newsletter_address_tombstones',
      'newsletter_erasure_checks',
      'person_erasure_scope',
    ])
      assert.equal(db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0);
  } finally {
    db.raw.close();
  }
});
