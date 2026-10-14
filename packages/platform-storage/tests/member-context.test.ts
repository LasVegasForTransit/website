import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFixture } from './support/merge-fixture';
import { getStaffPerson } from '../src/staff-people';
import { rosterDetails } from '../src/roster-details';
import { correctPerson } from '../src/corrections';
import { loadActor } from '../src/staff-roles';
import type { Db, Statement, SqlValue } from '../src/db';

void test('staff see current email confirmation and an email correction clears it', async () => {
  const f = await mergeFixture();
  try {
    assert.equal((await getStaffPerson(f.db, f.actor, f.survivor.id))?.emailVerified, false);
    await f.people.upsertFromSource({
      source: 'member',
      fields: { email: f.survivor.email },
      emailVerified: true,
    });
    assert.equal((await getStaffPerson(f.db, f.actor, f.survivor.id))?.emailVerified, true);
    const corrected = await correctPerson(f.db, f.actor, f.survivor.id, {
      fields: { email: 'new-context@example.invalid' },
      reason: 'Member supplied a new address',
      operationId: 'context-email',
    });
    assert.equal(corrected.kind, 'ok');
    assert.equal((await getStaffPerson(f.db, f.actor, f.survivor.id))?.emailVerified, false);
  } finally {
    f.db.raw.close();
  }
});
void test('combination notices require a current chain into the authorized member and disappear after undo', async () => {
  const f = await mergeFixture();
  try {
    const combined = await f.mergePeople(f.db, f.actor, f.input);
    assert.equal(combined.kind, 'ok');
    const profile = await getStaffPerson(f.db, f.actor, f.survivor.id, { mergedFrom: f.merged.id });
    assert.ok(profile?.mergeNotice);
    const date = f.db.raw
      .prepare('SELECT merged_at FROM merges WHERE merged_person_id=?')
      .get(f.merged.id)?.merged_at;
    assert.equal(profile.mergeNotice.mergedAt, date);
    assert.equal(
      (await getStaffPerson(f.db, f.actor, f.admin.id, { mergedFrom: f.merged.id }))?.mergeNotice,
      null,
    );
    assert.equal(
      (await getStaffPerson(f.db, f.actor, f.survivor.id, { mergedFrom: f.admin.id }))?.mergeNotice,
      null,
    );
    const merge = f.db.raw
      .prepare('SELECT id FROM merges WHERE merged_person_id=?')
      .get(f.merged.id);
    assert.ok(merge);
    assert.equal(
      (
        await f.undoMerge(f.db, f.actor, {
          mergeId: String(merge.id),
          reason: 'Two distinct members',
          operationId: 'undo-context',
        })
      ).kind,
      'ok',
    );
    assert.equal(
      (await getStaffPerson(f.db, f.actor, f.survivor.id, { mergedFrom: f.merged.id }))
        ?.mergeNotice,
      null,
    );
  } finally {
    f.db.raw.close();
  }
});
void test('bulk roster activity ignores corrections and private donations within current committee scope', async () => {
  const f = await mergeFixture();
  try {
    for (const [personId, role, operationId] of [
      [f.survivor.id, 'member', 'context-member'],
      [f.merged.id, 'lead', 'context-lead'],
    ] as const) {
      assert.equal(
        (
          await f.committees.assign({
            personId,
            committeeId: 'events',
            role,
            actorId: f.admin.id,
            operationId,
          })
        ).kind,
        'ok',
      );
    }
    await f.people.recordEngagement(f.survivor.id, {
      type: 'attended',
      occurredAt: '2997-01-01T12:00:00Z',
      source: 'fixture',
    });
    const attended = await f.people.recordEngagement(f.survivor.id, {
      type: 'attended',
      occurredAt: '2998-01-01T12:00:00Z',
      source: 'fixture',
    });
    await f.people.recordEngagement(f.survivor.id, {
      type: 'donated',
      occurredAt: '2999-01-01T12:00:00Z',
      source: 'givebutter',
    });
    await f.people.recordEngagement(f.survivor.id, {
      type: 'correction',
      occurredAt: '3000-01-01T12:00:00Z',
      reference: attended,
      source: 'staff',
    });
    const lead = await loadActor(f.db, f.merged.id);
    assert.ok(lead);
    const read = (actor = f.actor) =>
      rosterDetails(f.db, actor, [f.survivor.id], { includeActivity: true });
    assert.equal((await read()).get(f.survivor.id)?.lastEngagedAt, '2999-01-01T12:00:00Z');
    assert.equal((await read(lead)).get(f.survivor.id)?.lastEngagedAt, '2997-01-01T12:00:00Z');
  } finally {
    f.db.raw.close();
  }
});

void test('a combination lookup cannot outlive revoked staff access', async () => {
  const f = await mergeFixture();
  try {
    assert.equal((await f.mergePeople(f.db, f.actor, f.input)).kind, 'ok');
    const db = interceptReads(f.db, (sql, values) => {
      if (sql.includes('FROM merges') && values[0] === f.merged.id) {
        f.db.raw
          .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
          .run(f.admin.id);
      }
    });
    assert.equal(
      await getStaffPerson(db, f.actor, f.survivor.id, { mergedFrom: f.merged.id }),
      null,
    );
  } finally {
    f.db.raw.close();
  }
});
void test('combination notices never mix a source edge with a later undone snapshot', async () => {
  const f = await mergeFixture();
  try {
    const combined = await f.mergePeople(f.db, f.actor, f.input);
    assert.equal(combined.kind, 'ok');
    const state = { undone: false };
    const undo = async () => {
      assert.equal(
        (
          await f.undoMerge(f.db, f.actor, {
            mergeId: combined.value.mergeId,
            reason: 'Two distinct members',
            operationId: 'context-interleaved-undo',
          })
        ).kind,
        'ok',
      );
      state.undone = true;
    };
    const db = interceptReads(f.db, undefined, async (row) => {
      if (
        row &&
        'surviving_person_id' in row &&
        row.surviving_person_id === f.survivor.id &&
        !state.undone
      )
        await undo();
    });
    const result = await getStaffPerson(db, f.actor, f.survivor.id, { mergedFrom: f.merged.id });
    assert.ok(result);
    if (state.undone)
      assert.equal(
        result.mergeNotice,
        null,
        'a partial chain cannot prove a notice after actual undo',
      );
    else {
      assert.ok(result.mergeNotice);
      await undo();
    }
    assert.equal(
      (await getStaffPerson(f.db, f.actor, f.survivor.id, { mergedFrom: f.merged.id }))
        ?.mergeNotice,
      null,
    );
  } finally {
    f.db.raw.close();
  }
});

void test('combination notices follow the complete chain and reject corrupted cycles', async () => {
  const f = await mergeFixture();
  try {
    assert.equal((await f.mergePeople(f.db, f.actor, f.input)).kind, 'ok');
    const final = (
      await f.people.upsertFromSource({ source: 'paper', fields: { given_name: 'Final record' } })
    ).person;
    const second = await f.mergePeople(f.db, f.actor, {
      ...f.input,
      survivorId: final.id,
      mergedId: f.survivor.id,
      operationId: 'context-chain',
    });
    assert.equal(second.kind, 'ok');
    const profile = await getStaffPerson(f.db, f.actor, f.merged.id, { mergedFrom: f.merged.id });
    assert.ok(profile);
    assert.equal(profile.person.id, final.id);
    assert.equal(
      profile.mergeNotice?.mergedAt,
      f.db.raw.prepare('SELECT merged_at FROM merges WHERE merged_person_id=?').get(f.survivor.id)
        ?.merged_at,
    );
    f.db.raw
      .prepare(
        "INSERT INTO merges(id,surviving_person_id,merged_person_id,merged_at,merged_by,moved_rows,created_at,updated_at) VALUES('context-cycle',?,?,?,'fixture','{}',?,?)",
      )
      .run(
        f.merged.id,
        final.id,
        new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString(),
      );
    assert.equal(await getStaffPerson(f.db, f.actor, f.merged.id), null);
    assert.equal(
      (await getStaffPerson(f.db, f.actor, f.admin.id, { mergedFrom: f.merged.id }))?.mergeNotice,
      null,
    );
  } finally {
    f.db.raw.close();
  }
});

function interceptReads(
  db: Db,
  before?: (sql: string, values: SqlValue[]) => void | Promise<void>,
  after?: (row: Record<string, unknown> | null) => Promise<void>,
): Db {
  const wrap = (statement: Statement, sql: string, values: SqlValue[] = []): Statement => ({
    bind: (...next) => wrap(statement.bind(...next), sql, next),
    first: async <T>() => {
      await before?.(sql, values);
      const row = await statement.first<T>();
      await after?.(row as Record<string, unknown> | null);
      return row;
    },
    all: () => statement.all(),
    run: () => statement.run(),
  });
  return {
    prepare: (sql) => wrap(db.prepare(sql), sql),
    batch: (statements) => db.batch(statements),
  };
}
