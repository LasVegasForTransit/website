import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';
import { memoryDb } from './support/db';
import { PersonService } from '../src/person-service';
import { operationIsCurrent } from '../src/outbox';
import { recordAccessObservation } from '../src/access-observations';
void test('upgrade queues existing ordinary deletions while leaving active merge cleanup to its owner', async () => {
  const db = memoryDb(),
    people = new PersonService(db);
  db.raw.exec('DROP TRIGGER deleted_account_access');
  const add = async (email: string, externalId: string) => {
    const { person } = await people.upsertFromSource({ source: 'join_form', fields: { email } });
    await people.linkIdentity(person.id, {
      platform: 'discord',
      externalId,
      linkMethod: 'self_linked',
    });
    return person;
  };
  const deleted = await add('deleted@example.invalid', '222222222222222222');
  const archived = await add('archived@example.invalid', '333333333333333333');
  const survivor = await add('survivor@example.invalid', '444444444444444444');
  const observedAt = new Date().toISOString();
  assert.equal(
    await recordAccessObservation(db, {
      personId: deleted.id,
      targetId: 'person',
      provider: 'discord',
      identityId: '222222222222222222',
      identityEmail: null,
      resourceId: '555555555555555555',
      contextId: '111111111111111111',
      generation: 0,
      expectedAccess: false,
      state: 'absent',
      observedAt,
      expiresAt: new Date(Date.parse(observedAt) + 300_000).toISOString(),
    }),
    true,
  );
  // Old deletion erased contact fields but left the access observation behind.
  await db
    .prepare('UPDATE people SET deleted_at=?,email=NULL,updated_at=? WHERE id=?')
    .bind(observedAt, observedAt, deleted.id)
    .run();
  await people.deletePerson(archived.id);
  const stamp = (
    await db
      .prepare('SELECT deleted_at FROM people WHERE id=?')
      .bind(archived.id)
      .first<{ deleted_at: string }>()
  )?.deleted_at;
  assert.ok(stamp);
  await db
    .prepare(
      "INSERT INTO merges(id,surviving_person_id,merged_person_id,merged_at,merged_by,moved_rows,created_at,updated_at) VALUES('old-merge',?,?,?,?,'[]',?,?)",
    )
    .bind(survivor.id, archived.id, stamp, survivor.id, stamp, stamp)
    .run();
  assert.equal((await db.prepare('SELECT count(*) AS n FROM integration_outbox').first())?.n, 0);
  db.raw.exec(
    readFileSync(
      new URL('../migrations/0020_deleted_account_reconciliation.sql', import.meta.url),
      'utf8',
    ),
  );
  const jobs = (
    await db
      .prepare(
        "SELECT id,person_id,json_extract(payload,'$.source') AS source FROM integration_outbox",
      )
      .all<{ id: string; person_id: string; source: string }>()
  ).results;
  assert.equal(jobs.length, 1);
  const job = jobs[0];
  assert.ok(job);
  assert.equal(job.person_id, deleted.id);
  assert.equal(job.source, 'person_deleted');
  assert.equal(await operationIsCurrent(db, job.id), true);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM access_observations').first())?.n, 0);
  db.raw.close();
});
