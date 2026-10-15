import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMigrations, memoryDb } from './support/db';
import { PersonService } from '../src/person-service';
import { eraseLegacyFixturePerson } from './support/legacy-erasure';
import { useHistoricalMembershipSchema } from './support/legacy-membership';

void test('the cleanup migration requeues completed erased accounts and preserves reversible archives', async () => {
  const db = memoryDb();
  const people = new PersonService(db);
  try {
    const add = async (email: string) =>
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
    const removed = await add('removed@example.invalid');
    const archive = await add('archive@example.invalid');
    await eraseLegacyFixturePerson(db, removed.id);
    db.raw
      .prepare('UPDATE people SET deleted_at=? WHERE id=?')
      .run(new Date().toISOString(), archive.id);
    useHistoricalMembershipSchema(db, '0038_newsletter_erasure.sql');
    db.raw.prepare("UPDATE newsletter_sync_jobs SET state='done'").run();
    const before = Number(
      db.raw
        .prepare('SELECT generation FROM newsletter_sync_jobs WHERE person_id=?')
        .get(removed.id)?.generation,
    );
    applyMigrations(db.raw, '0039_newsletter_erasure_cleanup.sql');
    const cleaned = db.raw
      .prepare('SELECT state,generation FROM newsletter_sync_jobs WHERE person_id=?')
      .get(removed.id);
    assert.equal(cleaned?.state, 'queued');
    assert.equal(cleaned.generation, before + 1);
    assert.equal(
      db.raw.prepare('SELECT state FROM newsletter_sync_jobs WHERE person_id=?').get(archive.id)
        ?.state,
      'done',
    );
    assert.equal(await people.getPerson(removed.id), null);
    applyMigrations(db.raw, '0039_newsletter_erasure_cleanup.sql');
    assert.equal(
      db.raw
        .prepare('SELECT generation FROM newsletter_sync_jobs WHERE person_id=?')
        .get(removed.id)?.generation,
      before + 1,
    );
  } finally {
    db.raw.close();
  }
});
