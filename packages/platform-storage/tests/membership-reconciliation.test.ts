import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { PersonService } from '../src/person-service';
async function fixture() {
  const db = memoryDb(),
    people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'member@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  await people.linkIdentity(person.id, {
    platform: 'discord',
    externalId: '222222222222222222',
    linkMethod: 'self_linked',
  });
  await db
    .prepare(
      "INSERT INTO reconcile_generations(person_id,target_id,generation) VALUES(?,'person',3),(?,'civic-tech',7)",
    )
    .bind(person.id, person.id)
    .run();
  return { db, people, person };
}
void test('membership withdrawal queues current person and committee removal without another request', async () => {
  const { db, people, person } = await fixture();
  await people.withdrawConsent(person.id, {
    scope: 'newsletter',
    source: 'member',
    withdrawnAt: new Date().toISOString(),
  });
  const rows = (
    await db
      .prepare('SELECT target_id,generation,state FROM integration_outbox ORDER BY target_id')
      .all()
  ).results;
  assert.deepEqual(
    rows.map((row) => ({ ...row })),
    [
      { target_id: 'civic-tech', generation: 8, state: 'queued' },
      { target_id: 'person', generation: 4, state: 'queued' },
    ],
  );
  assert.equal((await people.getPerson(person.id))?.membership_status, 'former_member');
});
void test('a failed reconciliation enqueue rolls back consent withdrawal, evidence and membership together', async () => {
  const { db, people, person } = await fixture();
  db.raw.exec(
    "CREATE TRIGGER reject_member_job BEFORE INSERT ON integration_outbox BEGIN SELECT RAISE(ABORT,'fixture enqueue failure'); END",
  );
  await assert.rejects(
    people.withdrawConsent(person.id, {
      scope: 'newsletter',
      source: 'member',
      withdrawnAt: new Date().toISOString(),
    }),
    /fixture enqueue failure/,
  );
  assert.equal((await people.getPerson(person.id))?.membership_status, 'member');
  assert.equal(
    (await db.prepare('SELECT withdrawn_at FROM consent_records').first())?.withdrawn_at,
    null,
  );
  assert.equal(
    (await db.prepare('SELECT count(*) AS count FROM consent_withdrawals').first())?.count,
    0,
  );
  assert.equal(
    (await db.prepare('SELECT count(*) AS count FROM integration_outbox').first())?.count,
    0,
  );
});
void test('unchanged membership does not enqueue more work, and rejoining advances to a new grant generation', async () => {
  const { db, people, person } = await fixture();
  const withdrawal = {
    scope: 'newsletter' as const,
    source: 'member',
    withdrawnAt: new Date().toISOString(),
  };
  await people.withdrawConsent(person.id, withdrawal);
  await people.withdrawConsent(person.id, withdrawal);
  assert.equal(
    (await db.prepare('SELECT count(*) AS count FROM integration_outbox').first())?.count,
    2,
  );
  await people.recordConsent(person.id, {
    scope: 'newsletter',
    source: 'join_form',
    method: 'checkbox',
    wordingVersion: 'fixture',
    givenAt: new Date().toISOString(),
  });
  assert.equal((await people.getPerson(person.id))?.membership_status, 'member');
  assert.equal(
    (
      await db
        .prepare("SELECT generation FROM reconcile_generations WHERE target_id='person'")
        .first()
    )?.generation,
    5,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) AS count FROM integration_outbox WHERE state='superseded'")
        .first()
    )?.count,
    2,
  );
});
