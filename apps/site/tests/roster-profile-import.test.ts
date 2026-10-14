import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { applyRosterImport, previewRosterImport } from '../platform/roster-import';

const record = {
  source: 'beehiiv',
  sourceId: 'subscriber-profile-fixture',
  email: 'profile@example.invalid',
  givenName: '  Ana María  ',
  familyName: '  de la Cruz  ',
  newsletter: { state: 'active', givenAt: '2026-06-22T18:50:32.000Z' },
};
const options = { runId: 'profile-import-fixture', now: new Date('2026-10-14T12:00:00.000Z') };

void test('roster imports retain supplied names for the staff member directory', async () => {
  const db = memoryDb();
  try {
    assert.equal((await applyRosterImport(db, [record], options)).counts.applied, 1);
    const person = db.raw
      .prepare('SELECT given_name,family_name,membership_status FROM people')
      .get();
    assert.ok(person);
    assert.equal(person.given_name, 'Ana María');
    assert.equal(person.family_name, 'de la Cruz');
    assert.equal(person.membership_status, 'member');
  } finally {
    db.raw.close();
  }
});

void test('import replay fills missing names and preserves names already corrected by staff', async () => {
  const db = memoryDb();
  try {
    await applyRosterImport(db, [{ ...record, familyName: null }], options);
    const people = new PersonService(db);
    const person = await people.findByEmail(record.email);
    assert.ok(person);
    await people.updateFields(person.id, { source: 'staff', fields: { given_name: 'Ana' } });
    const replay = await applyRosterImport(db, [record], options);
    assert.equal(replay.counts.alreadyApplied, 1);
    const updated = await people.getPerson(person.id);
    assert.ok(updated);
    assert.equal(updated.given_name, 'Ana');
    assert.equal(updated.family_name, 'de la Cruz');
    await applyRosterImport(
      db,
      [{ ...record, givenName: 'Old name', familyName: 'Old surname' }],
      options,
    );
    const retained = await people.getPerson(person.id);
    assert.ok(retained);
    assert.equal(retained.given_name, 'Ana');
    assert.equal(retained.family_name, 'de la Cruz');
    assert.equal(db.raw.prepare('SELECT count(*) AS count FROM consent_records').get()?.count, 1);
  } finally {
    db.raw.close();
  }
});

void test('invalid imported names are isolated before any person or consent is created', async () => {
  const db = memoryDb();
  try {
    const invalid = [
      { ...record, givenName: false },
      { ...record, sourceId: 'other-id', email: 'other@example.invalid', familyName: ['Surname'] },
      { ...record, sourceId: 'long-id', email: 'long@example.invalid', givenName: 'a'.repeat(101) },
    ];
    const preview = previewRosterImport(invalid, options);
    assert.equal(preview.counts.conflictRecords, 3);
    assert.equal(preview.counts.importablePeople, 0);
    assert.ok(preview.records.every((row) => row.reasons.includes('name_invalid')));
    assert.equal((await applyRosterImport(db, invalid, options)).counts.conflicts, 3);
    assert.equal(db.raw.prepare('SELECT count(*) AS count FROM people').get()?.count, 0);
    assert.equal(db.raw.prepare('SELECT count(*) AS count FROM consent_records').get()?.count, 0);
  } finally {
    db.raw.close();
  }
});

void test('an import cannot overwrite a staff correction made while the import is being saved', async () => {
  const db = memoryDb();
  try {
    await applyRosterImport(db, [{ ...record, givenName: null, familyName: null }], options);
    const people = new PersonService(db);
    const person = await people.findByEmail(record.email);
    assert.ok(person);
    let correctionPending = true;
    const concurrent: Db = {
      prepare: (sql) => db.prepare(sql),
      async batch(statements) {
        if (correctionPending) {
          correctionPending = false;
          await people.updateFields(person.id, {
            source: 'staff',
            fields: { given_name: 'Staff correction' },
          });
        }
        return db.batch(statements);
      },
    };
    await applyRosterImport(concurrent, [record], options);
    assert.equal((await people.getPerson(person.id))?.given_name, 'Staff correction');
    assert.equal((await people.getPerson(person.id))?.family_name, 'de la Cruz');
    assert.equal(
      db.raw
        .prepare("SELECT source FROM field_sources WHERE person_id=? AND field='given_name'")
        .get(person.id)?.source,
      'staff',
    );
    assert.equal(
      db.raw
        .prepare("SELECT source FROM field_sources WHERE person_id=? AND field='family_name'")
        .get(person.id)?.source,
      'import',
    );
    await applyRosterImport(db, [record], options);
    assert.equal((await people.getPerson(person.id))?.family_name, 'de la Cruz');
    assert.equal(db.raw.prepare('SELECT count(*) AS count FROM consent_records').get()?.count, 1);
  } finally {
    db.raw.close();
  }
});
