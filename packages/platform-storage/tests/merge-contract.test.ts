import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFixture } from './support/merge-fixture';
import { queryBudget } from '../src/query-budget';
import { PersonService } from '../src/person-service';
import { mergeView } from '../src/merge-views';
import { resolvePersonId } from '../src/person-resolution';
import type { Db, Statement } from '../src/db';
import { saveNewsletterEvent } from '../src/newsletter-inbound';
import { newsletterEmailKey } from '../src/newsletter-work';

void test('refusing exact-subject erasure leaves the survivor newsletter inbox and tombstones unchanged', async () => {
  const f = await mergeFixture();
  assert.equal((await f.mergePeople(f.db, f.actor, f.input)).kind, 'ok');
  const now = new Date();
  await saveNewsletterEvent(f.db, {
    publicationId: 'fixture-publication',
    id: 'pending-survivor-event',
    messageId: 'pending-survivor-delivery',
    type: 'subscription.confirmed',
    occurredAt: now.toISOString(),
    subscriptionId: 'pending-survivor-subscription',
    emailKey: await newsletterEmailKey(f.survivor.email ?? ''),
    encryptedEmail: 'private-fixture-envelope',
    now,
  });
  const before = f.db.raw.prepare('SELECT * FROM newsletter_inbound_events').all();
  await f.people.deletePerson(f.merged.id, { requireActiveSubject: true });
  assert.deepEqual(f.db.raw.prepare('SELECT * FROM newsletter_inbound_events').all(), before);
  assert.equal(
    f.db.raw.prepare('SELECT count(*) AS n FROM newsletter_address_tombstones').get()?.n,
    0,
  );
  assert.equal(
    f.db.raw.prepare('SELECT erased_at FROM people WHERE id=?').get(f.survivor.id)?.erased_at,
    null,
  );
});

void test('verification racing a merge cannot repopulate its archived profile or prevent undo', async () => {
  const f = await mergeFixture();
  await f.people.updateFields(f.survivor.id, {
    source: 'staff',
    fields: { email: null },
    allowClear: true,
  });
  await f.people.updateFields(f.merged.id, {
    source: 'staff',
    fields: { email: 'verification-race@example.invalid' },
  });
  let merged: Awaited<ReturnType<typeof f.mergePeople>> | undefined;
  const wrap = (statement: Statement): Statement => ({
    bind: (...values) => wrap(statement.bind(...values)),
    first: statement.first.bind(statement),
    all: statement.all.bind(statement),
    run: async () => {
      merged ??= await f.mergePeople(f.db, f.actor, f.input);
      return statement.run();
    },
  });
  const db: Db = {
    prepare: (sql) =>
      sql.startsWith('UPDATE people SET email_verified_at')
        ? wrap(f.db.prepare(sql))
        : f.db.prepare(sql),
    batch: (statements) => f.db.batch(statements),
  };
  await assert.rejects(
    new PersonService(db).upsertFromSource({
      source: 'join_form',
      fields: { email: 'verification-race@example.invalid' },
      emailVerified: true,
    }),
    /vanished/,
  );
  assert.equal(merged?.kind, 'ok');
  assert.equal(
    f.db.raw.prepare('SELECT email_verified_at FROM people WHERE id=?').get(f.merged.id)
      ?.email_verified_at,
    null,
  );
  assert.equal(
    (
      await f.undoMerge(f.db, f.actor, {
        mergeId: merged.value.mergeId,
        reason: 'Separate members',
        operationId: 'undo-verification-race',
      })
    ).kind,
    'ok',
  );
});

void test('a source upsert cannot return another profile if its matched person merges during the write', async () => {
  const f = await mergeFixture();
  await f.people.updateFields(f.survivor.id, {
    source: 'staff',
    fields: { email: null },
    allowClear: true,
  });
  await f.people.updateFields(f.merged.id, {
    source: 'staff',
    fields: { email: 'source-before-merge@example.invalid' },
  });
  let raced = false;
  const db: Db = {
    prepare: (sql) => f.db.prepare(sql),
    batch: async (statements) => {
      const saved = await f.db.batch(statements);
      if (!raced) {
        raced = true;
        assert.equal((await f.mergePeople(f.db, f.actor, f.input)).kind, 'ok');
      }
      return saved;
    },
  };
  await assert.rejects(
    new PersonService(db).upsertFromSource({
      source: 'join_form',
      fields: {
        email: 'source-before-merge@example.invalid',
        family_name: 'Updated during source intake',
      },
    }),
    /vanished/,
  );
});

void test('an inconsistent active-row cycle cannot resolve to a live member', async () => {
  const f = await mergeFixture();
  assert.equal((await f.mergePeople(f.db, f.actor, f.input)).kind, 'ok');
  const stamp = new Date().toISOString();
  f.db.raw
    .prepare(
      "INSERT INTO merges(id,surviving_person_id,merged_person_id,merged_at,merged_by,moved_rows,created_at,updated_at) VALUES('corrupt-cycle',?,?,?,'fixture','{}',?,?)",
    )
    .run(f.merged.id, f.survivor.id, stamp, stamp, stamp);
  assert.equal(await f.people.getPerson(f.merged.id), null);
  assert.equal(await f.people.getPerson(f.survivor.id), null);
  assert.equal(await resolvePersonId(f.db, f.merged.id), null);
});

void test('an administrator can identify the cleared archived entry when reviewing an undo', async () => {
  const f = await mergeFixture();
  const combined = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(combined.kind, 'ok');
  assert.equal((await mergeView(f.db, f.actor, combined.value.mergeId))?.mergedName, 'Other entry');
});

void test('a simple person lookup resolves aliases in one database statement', async () => {
  const f = await mergeFixture();
  const budget = queryBudget(f.db, 1);
  assert.equal((await new PersonService(budget.db).getPerson(f.survivor.id))?.id, f.survivor.id);
  assert.equal(budget.queries, 1);
});

void test('the earlier-created person survives either input order and reversed retries are identical', async () => {
  const f = await mergeFixture();
  f.db.raw.prepare('UPDATE people SET created_at=? WHERE id=?').run('2020-01-01', f.survivor.id);
  f.db.raw.prepare('UPDATE people SET created_at=? WHERE id=?').run('2021-01-01', f.merged.id);
  const reversed = { ...f.input, survivorId: f.merged.id, mergedId: f.survivor.id };
  const result = await f.mergePeople(f.db, f.actor, reversed);
  assert.equal(result.kind, 'ok');
  assert.equal(
    f.db.raw.prepare('SELECT surviving_person_id FROM merges').get()?.surviving_person_id,
    f.survivor.id,
  );
  assert.deepEqual(await f.mergePeople(f.db, f.actor, f.input), result);
});

void test('old identifiers resolve to the active survivor with counts, without redirecting writes or erased people', async () => {
  const f = await mergeFixture();
  assert.equal((await f.mergePeople(f.db, f.actor, f.input)).kind, 'ok');
  assert.equal((await f.people.getPerson(f.merged.id))?.id, f.survivor.id);
  assert.equal(
    (await f.people.getPerson(f.merged.id, { withCounts: true }))?.counts.attended_total,
    0,
  );
  assert.equal(
    await f.people.updateFields(f.merged.id, { source: 'staff', fields: { phone: 'forged' } }),
    null,
  );
  assert.equal((await f.people.getPerson(f.survivor.id))?.phone, '+17025550100');
  await f.people.deletePerson(f.survivor.id);
  assert.equal(await f.people.getPerson(f.merged.id), null);
});

void test('merged profiles clear personal fields and preserve every original field source for exact undo', async () => {
  const f = await mergeFixture();
  const profiles = f.db.raw
    .prepare('SELECT * FROM people WHERE id IN (?,?) ORDER BY id')
    .all(f.survivor.id, f.merged.id);
  const sources = f.db.raw
    .prepare('SELECT * FROM field_sources WHERE person_id IN (?,?) ORDER BY person_id,field')
    .all(f.survivor.id, f.merged.id);
  const combined = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(combined.kind, 'ok');
  const archived = f.db.raw.prepare('SELECT * FROM people WHERE id=?').get(f.merged.id);
  assert.ok(archived);
  for (const field of [
    'given_name',
    'family_name',
    'email',
    'email_verified_at',
    'phone',
    'zip',
    'census_block',
    'census_block_vintage',
    'place_name',
    'region_id',
    'region_source',
    'region_set_at',
  ])
    assert.equal(archived[field], null, field);
  assert.equal(
    f.db.raw.prepare('SELECT count(*) AS n FROM field_sources WHERE person_id=?').get(f.merged.id)
      ?.n,
    0,
  );
  assert.equal(
    (
      await f.undoMerge(f.db, f.actor, {
        mergeId: combined.value.mergeId,
        reason: 'Different people',
        operationId: 'exact-undo',
      })
    ).kind,
    'ok',
  );
  const after = f.db.raw
    .prepare('SELECT * FROM people WHERE id IN (?,?) ORDER BY id')
    .all(f.survivor.id, f.merged.id);
  assert.deepEqual(
    after.map(({ updated_at: _updated, ...row }) => row),
    profiles.map(({ updated_at: _updated, ...row }) => row),
  );
  assert.deepEqual(
    f.db.raw
      .prepare('SELECT * FROM field_sources WHERE person_id IN (?,?) ORDER BY person_id,field')
      .all(f.survivor.id, f.merged.id),
    sources,
  );
});

void test('attempting a merge cycle explains the refusal and changes no people or merge records', async () => {
  const f = await mergeFixture();
  assert.equal((await f.mergePeople(f.db, f.actor, f.input)).kind, 'ok');
  const before = f.db.raw.prepare('SELECT * FROM people ORDER BY id').all();
  const merges = f.db.raw.prepare('SELECT * FROM merges ORDER BY id').all();
  const refused = await f.mergePeople(f.db, f.actor, {
    ...f.input,
    survivorId: f.merged.id,
    mergedId: f.survivor.id,
    operationId: 'cycle',
  });
  assert.deepEqual(refused, { kind: 'conflict', reason: 'already_combined' });
  assert.deepEqual(f.db.raw.prepare('SELECT * FROM people ORDER BY id').all(), before);
  assert.deepEqual(f.db.raw.prepare('SELECT * FROM merges ORDER BY id').all(), merges);
});

void test('two survivor trees undo separately in dependency order and refuse an inner undo with an explanation', async () => {
  const f = await mergeFixture();
  f.db.raw.prepare('UPDATE people SET created_at=? WHERE id=?').run('2020-01-01', f.survivor.id);
  f.db.raw.prepare('UPDATE people SET created_at=? WHERE id=?').run('2021-01-01', f.merged.id);
  const second = (
    await f.people.upsertFromSource({ source: 'paper', fields: { given_name: 'Second root' } })
  ).person;
  const leaf = (
    await f.people.upsertFromSource({
      source: 'paper',
      fields: { given_name: 'Second leaf', phone: '+17025550222' },
    })
  ).person;
  f.db.raw.prepare('UPDATE people SET created_at=? WHERE id=?').run('2022-01-01', second.id);
  f.db.raw.prepare('UPDATE people SET created_at=? WHERE id=?').run('2023-01-01', leaf.id);
  for (const id of [second.id, leaf.id])
    await f.people.recordConsent(id, {
      scope: 'newsletter',
      source: 'paper',
      method: 'paper_signature',
      wordingVersion: 'chain-fixture',
      givenAt: '2026-01-01T00:00:00Z',
    });
  const originalPeople = f.db.raw.prepare('SELECT * FROM people ORDER BY id').all();
  const originalEvents = f.db.raw.prepare('SELECT * FROM engagement_events ORDER BY id').all();
  const first = await f.mergePeople(f.db, f.actor, f.input);
  const other = await f.mergePeople(f.db, f.actor, {
    ...f.input,
    survivorId: second.id,
    mergedId: leaf.id,
    operationId: 'second-tree',
  });
  assert.equal(first.kind, 'ok');
  assert.equal(other.kind, 'ok');
  const outer = await f.mergePeople(f.db, f.actor, {
    ...f.input,
    survivorId: second.id,
    mergedId: f.survivor.id,
    operationId: 'outer',
  });
  assert.equal(outer.kind, 'ok');
  assert.equal((await f.people.getPerson(leaf.id))?.id, f.survivor.id);
  const beforeRefused = f.db.raw.prepare('SELECT * FROM people ORDER BY id').all();
  assert.deepEqual(
    await f.undoMerge(f.db, f.actor, {
      mergeId: other.value.mergeId,
      reason: 'Split entries',
      operationId: 'inner-too-early',
    }),
    { kind: 'conflict', reason: 'undo_newer_merge_first' },
  );
  assert.deepEqual(f.db.raw.prepare('SELECT * FROM people ORDER BY id').all(), beforeRefused);
  for (const [operationId, mergeId] of [
    ['outer-undo', outer.value.mergeId],
    ['second-undo', other.value.mergeId],
    ['first-undo', first.value.mergeId],
  ] as const) {
    assert.equal(
      (
        await f.undoMerge(f.db, f.actor, {
          mergeId,
          reason: 'Split entries',
          operationId,
        })
      ).kind,
      'ok',
    );
  }
  assert.deepEqual(
    f.db.raw
      .prepare('SELECT * FROM people ORDER BY id')
      .all()
      .map(({ updated_at: _updated, ...row }) => row),
    originalPeople.map(({ updated_at: _updated, ...row }) => row),
  );
  assert.deepEqual(
    f.db.raw.prepare('SELECT * FROM engagement_events ORDER BY id').all(),
    originalEvents,
  );
});
