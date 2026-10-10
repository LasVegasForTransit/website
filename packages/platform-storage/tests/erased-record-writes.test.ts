import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { PersonService } from '../src/person-service';
import { recordEvent } from '../src/engagement';
import { runMaintenance } from '../src/retention';
void test('an erased internal ID cannot accept late personal records before or after profile retention', async () => {
  for (const purge of [false, true]) {
    const db = memoryDb();
    db.raw.exec(
      "INSERT INTO people(id,created_at,updated_at) VALUES('erased','2026-01-01','2026-01-01')",
    );
    await new PersonService(db).deletePerson('erased');
    if (purge) await runMaintenance(db, { now: new Date('2030-01-01T00:00:00.000Z') });
    await assert.rejects(
      recordEvent(db, 'erased', {
        type: 'attended',
        occurredAt: '2026-10-09',
        source: 'late-provider',
        details: { name: 'Private late copy' },
      }),
      /erasure/,
    );
    assert.throws(
      () =>
        db.raw.exec(
          "INSERT INTO consent_records(id,person_id,scope,given_at,source,method,created_at,updated_at) VALUES('late','erased','newsletter','2026-10-09','import','unknown','2026-10-09','2026-10-09')",
        ),
      /erasure/,
    );
    assert.throws(
      () =>
        db.raw.exec(
          "INSERT INTO sessions(id_hash,person_id,type,created_at,last_used_at,expires_at,updated_at) VALUES('late','erased','member','2026-10-09','2026-10-09','2031-01-01','2026-10-09')",
        ),
      /erasure/,
    );
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM engagement_events').get()?.n, 0);
    db.raw.close();
  }
});
void test('retention clears late copies left by an earlier deployment before erasure write guards existed', async () => {
  const db = memoryDb('0024_person_erasure.sql');
  db.raw.exec(
    "INSERT INTO people(id,created_at,updated_at) VALUES('old-erased','2026-01-01','2026-01-01')",
  );
  await new PersonService(db).deletePerson('old-erased');
  await recordEvent(db, 'old-erased', {
    type: 'attended',
    occurredAt: '2026-10-09',
    source: 'late-provider',
    details: { name: 'Private late copy' },
  });
  const { applyMigrations } = await import('./support/db');
  applyMigrations(db.raw);
  await runMaintenance(db, { now: new Date('2030-01-01T00:00:00.000Z') });
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM engagement_events').get()?.n, 0);
  db.raw.close();
});
