import assert from 'node:assert/strict';
import test from 'node:test';
import type { Db } from '../src/db';
import { correctPerson } from '../src/corrections';
import { mergeFixture } from './support/merge-fixture';

void test('deletion erases active merge archives and correction snapshots without restoring them on undo', async () => {
  const f = await mergeFixture();
  await correctPerson(f.db, f.actor, f.merged.id, {
    fields: { family_name: 'Private family name' },
    reason: 'Confirmed Private family name',
    operationId: 'private-correction',
  });
  await f.people.linkIdentity(f.merged.id, {
    platform: 'discord',
    externalId: '222222222222222222',
    externalEmail: 'private-discord@example.invalid',
    linkMethod: 'self_linked',
  });
  const combined = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(combined.kind, 'ok');
  await f.people.deletePerson(f.survivor.id);
  for (const id of [f.survivor.id, f.merged.id]) {
    const row = f.db.raw.prepare('SELECT * FROM people WHERE id=?').get(id);
    assert.ok(row?.deleted_at);
    for (const field of ['given_name', 'family_name', 'email', 'email_verified_at', 'phone'])
      assert.equal(row[field], null, `${id}: ${field}`);
    assert.ok(row.erased_at);
    for (const table of ['person_corrections', 'engagement_events', 'field_sources'])
      assert.equal(
        f.db.raw.prepare(`SELECT count(*) AS n FROM ${table} WHERE person_id=?`).get(id)?.n,
        0,
      );
  }
  const archive = f.db.raw.prepare('SELECT * FROM merges WHERE id=?').get(combined.value.mergeId);
  assert.equal(archive?.moved_rows, '{}');
  assert.equal(archive.reason, null);
  assert.ok(archive.erased_at);
  const stored = [
    'people',
    'merges',
    'person_corrections',
    'engagement_events',
    'staff_operations',
    'staff_audits',
  ]
    .map((table) => JSON.stringify(f.db.raw.prepare(`SELECT * FROM ${table}`).all()))
    .join('\n');
  for (const secret of [
    'Private family name',
    'private-discord@example.invalid',
    '+17025550100',
    'survivor@example.invalid',
  ])
    assert.equal(stored.includes(secret), false, secret);
  assert.equal(
    (
      await f.undoMerge(f.db, f.actor, {
        mergeId: combined.value.mergeId,
        reason: 'Try after erasure',
        operationId: 'private-undo',
      })
    ).kind,
    'conflict',
  );
  assert.equal(
    f.db.raw
      .prepare("SELECT external_id,external_email FROM identities WHERE platform='discord'")
      .get()?.external_id,
    '222222222222222222',
  );
  assert.equal(
    f.db.raw.prepare("SELECT external_email FROM identities WHERE platform='discord'").get()
      ?.external_email,
    null,
  );
  assert.equal(
    f.db.raw
      .prepare(
        "SELECT count(*) AS n FROM integration_outbox WHERE person_id=? AND state='queued' AND json_extract(payload,'$.source')='person_deleted'",
      )
      .get(f.survivor.id)?.n,
    1,
  );
  const before = JSON.stringify(f.db.raw.prepare('SELECT * FROM people ORDER BY id').all());
  await f.people.deletePerson(f.survivor.id);
  assert.equal(JSON.stringify(f.db.raw.prepare('SELECT * FROM people ORDER BY id').all()), before);
  f.db.raw.close();
});

void test('erasure follows chained active combinations while keeping a separated person intact', async () => {
  const f = await mergeFixture();
  const separated = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(separated.kind, 'ok');
  assert.equal(
    (
      await f.undoMerge(f.db, f.actor, {
        mergeId: separated.value.mergeId,
        reason: 'Separate people',
        operationId: 'separate',
      })
    ).kind,
    'ok',
  );
  const third = (
    await f.people.upsertFromSource({ source: 'paper', fields: { given_name: 'Third entry' } })
  ).person;
  const fourth = (
    await f.people.upsertFromSource({ source: 'paper', fields: { given_name: 'Fourth entry' } })
  ).person;
  assert.equal(
    (
      await f.mergePeople(f.db, f.actor, {
        ...f.input,
        survivorId: third.id,
        mergedId: fourth.id,
        operationId: 'chain-one',
      })
    ).kind,
    'ok',
  );
  const last = await f.mergePeople(f.db, f.actor, {
    ...f.input,
    mergedId: third.id,
    operationId: 'chain-two',
  });
  assert.equal(last.kind, 'ok');
  await f.people.deletePerson(f.survivor.id);
  for (const id of [f.survivor.id, third.id, fourth.id])
    assert.equal(
      f.db.raw.prepare('SELECT given_name FROM people WHERE id=?').get(id)?.given_name,
      null,
    );
  assert.equal((await f.people.getPerson(f.merged.id))?.given_name, 'Other entry');
  assert.equal((await f.people.getPerson(f.admin.id))?.given_name, 'Administrator');
  assert.equal(
    f.db.raw.prepare('SELECT moved_rows FROM merges WHERE id=?').get(separated.value.mergeId)
      ?.moved_rows,
    '{}',
  );
  f.db.raw.close();
});

void test('erasure and a concurrent undo cannot restore erased snapshots', async () => {
  const f = await mergeFixture();
  const combined = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(combined.kind, 'ok');
  const raced: Db = {
    prepare: (sql) => f.db.prepare(sql),
    batch: async (statements) => {
      await f.people.deletePerson(f.survivor.id);
      return f.db.batch(statements);
    },
  };
  assert.equal(
    (
      await f.undoMerge(raced, f.actor, {
        mergeId: combined.value.mergeId,
        reason: 'Concurrent undo',
        operationId: 'raced-erasure',
      })
    ).kind,
    'conflict',
  );
  assert.equal(
    f.db.raw.prepare('SELECT phone FROM people WHERE id=?').get(f.merged.id)?.phone,
    null,
  );
  f.db.raw.close();
});

void test('an erasure failure rolls back profiles, snapshots, cleanup jobs and temporary permission', async () => {
  const f = await mergeFixture();
  assert.equal((await f.mergePeople(f.db, f.actor, f.input)).kind, 'ok');
  const tables = [
    'people',
    'merges',
    'staff_operations',
    'staff_audits',
    'integration_outbox',
    'reconcile_generations',
    'engagement_events',
  ];
  const snapshot = () =>
    tables.map((table) => JSON.stringify(f.db.raw.prepare(`SELECT * FROM ${table}`).all()));
  const before = snapshot();
  f.db.raw.exec(
    "CREATE TRIGGER fail_erasure BEFORE DELETE ON person_erasure_scope BEGIN SELECT RAISE(ABORT,'fixture_erasure_failure'); END",
  );
  await assert.rejects(f.people.deletePerson(f.survivor.id), /fixture_erasure_failure/);
  assert.deepEqual(snapshot(), before);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM person_erasure_scope').get()?.n, 0);
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM person_erasure_copies').get()?.n, 0);
  f.db.raw.exec('DROP TRIGGER fail_erasure');
  await f.people.deletePerson(f.survivor.id);
  assert.equal(await f.people.getPerson(f.survivor.id), null);
  f.db.raw.close();
});

void test('ordinary writes cannot redact retained audits or change or revive erased bookkeeping', async () => {
  const f = await mergeFixture();
  const combined = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(combined.kind, 'ok');
  assert.throws(
    () =>
      f.db.raw
        .prepare("UPDATE merges SET moved_rows='{}',reason=NULL,erased_at='2090-01-01' WHERE id=?")
        .run(combined.value.mergeId),
    /bookkeeping cannot/,
  );
  assert.throws(
    () => f.db.raw.exec('UPDATE staff_audits SET details=\'{"personalDataErased":true}\''),
    /audits cannot/,
  );
  await f.people.deletePerson(f.survivor.id);
  assert.throws(
    () => f.db.raw.prepare('UPDATE people SET deleted_at=NULL WHERE id=?').run(f.merged.id),
    /erased|CHECK constraint/,
  );
  assert.throws(
    () => f.db.raw.prepare('UPDATE people SET erased_at=NULL WHERE id=?').run(f.merged.id),
    /erased/,
  );
  assert.throws(() => f.db.raw.exec("UPDATE staff_audits SET actor_id='forged'"), /audits cannot/);
  assert.throws(
    () =>
      f.db.raw.prepare('UPDATE merges SET erased_at=NULL WHERE id=?').run(combined.value.mergeId),
    /bookkeeping cannot/,
  );
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM person_erasure_scope').get()?.n, 0);
  f.db.raw.close();
});

void test('deleting an archived reference erases its current combined profile, but a completed separation wins before deletion', async () => {
  for (const separate of [false, true]) {
    const f = await mergeFixture();
    const combined = await f.mergePeople(f.db, f.actor, f.input);
    assert.equal(combined.kind, 'ok');
    const raced: Db = {
      prepare: (sql) => f.db.prepare(sql),
      batch: async (statements) => {
        if (separate)
          assert.equal(
            (
              await f.undoMerge(f.db, f.actor, {
                mergeId: combined.value.mergeId,
                reason: 'Two members',
                operationId: 'separate-before-deletion',
              })
            ).kind,
            'ok',
          );
        return f.db.batch(statements);
      },
    };
    const { PersonService } = await import('../src/person-service');
    await new PersonService(raced).deletePerson(f.merged.id);
    assert.equal(await f.people.getPerson(f.merged.id), null);
    assert.equal(Boolean(await f.people.getPerson(f.survivor.id)), separate);
    assert.equal(
      f.db.raw.prepare('SELECT phone FROM people WHERE id=?').get(f.merged.id)?.phone,
      null,
    );
    f.db.raw.close();
  }
});
