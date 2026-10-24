import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMigrations } from './support/db';
import { mergeFixture } from './support/merge-fixture';

void test('upgrading a legacy erased review archive preserves its remaining reviews and undo', async () => {
  const f = await mergeFixture('0053_scheduled_wake_signals.sql');
  try {
    f.db.raw
      .prepare(
        `INSERT INTO review_queue(id,candidate_person_id,existing_person_id,reason,created_at,updated_at,details)
      VALUES('retained-review',?,?,'possible_duplicate','2026-01-01','2026-01-01','{}')`,
      )
      .run(f.merged.id, f.survivor.id);
    const combined = await f.mergePeople(f.db, f.actor, f.input);
    assert.equal(combined.kind, 'ok');
    const original = JSON.parse(
      String(
        f.db.raw.prepare('SELECT moved_rows FROM merges WHERE id=?').get(combined.value.mergeId)
          ?.moved_rows,
      ),
    ) as { reviews: unknown; [key: string]: unknown };
    const trigger = String(
      f.db.raw
        .prepare("SELECT sql FROM sqlite_master WHERE name='merges_bookkeeping_immutable'")
        .get()?.sql,
    );
    // Reproduce the representation written by the previous erasure query.
    // Other archive fields must survive the upgrade without modification.
    f.db.raw.exec('DROP TRIGGER merges_bookkeeping_immutable');
    f.db.raw
      .prepare("UPDATE merges SET moved_rows=json_set(moved_rows,'$.reviews',?) WHERE id=?")
      .run(JSON.stringify(original.reviews), combined.value.mergeId);
    f.db.raw.exec(trigger);
    applyMigrations(f.db.raw);
    const repaired = JSON.parse(
      String(
        f.db.raw.prepare('SELECT moved_rows FROM merges WHERE id=?').get(combined.value.mergeId)
          ?.moved_rows,
      ),
    ) as typeof original;
    assert.ok(Array.isArray(repaired.reviews));
    assert.equal(repaired.reviews.length, 1);
    assert.deepEqual(repaired, original);
    assert.throws(
      () =>
        f.db.raw
          .prepare("UPDATE merges SET moved_rows='{}' WHERE id=?")
          .run(combined.value.mergeId),
      /bookkeeping cannot/,
    );
    assert.equal(
      (
        await f.undoMerge(f.db, f.actor, {
          mergeId: combined.value.mergeId,
          reason: 'Different people',
          operationId: 'undo-repaired-review-array',
        })
      ).kind,
      'ok',
    );
    assert.equal((await f.people.getPerson(f.merged.id))?.phone, '+17025550100');
  } finally {
    f.db.raw.close();
  }
});
