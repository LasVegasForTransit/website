import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';
import { applyMigrations } from './support/db';
import { mergeFixture } from './support/merge-fixture';

void test('an existing active merge stays reversible after the erasure migration', async () => {
  const f = await mergeFixture('0024_person_erasure.sql');
  const combined = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(combined.kind, 'ok');
  // Recreate the previous canonical schema and snapshot shape, then apply the
  // real upgrade. Old archives have no erased_at field in their saved people.
  f.db.raw.exec(`DROP TRIGGER merges_bookkeeping_immutable;
    UPDATE merges SET moved_rows=json_remove(moved_rows,'$.archivedBefore.erased_at','$.archivedAfter.erased_at');
    DROP TRIGGER staff_audit_append_only;
    DROP TRIGGER erased_person_no_restore;
    DROP TRIGGER person_erasure_scope_no_update;
    DROP TRIGGER person_erasure_copies_no_update;
    DROP TRIGGER staff_operation_sequence;
    DROP TRIGGER staff_operation_order_no_update;
    DROP TRIGGER staff_operation_order_no_delete;
    DROP VIEW merge_copy_intervals;
    DROP TABLE person_erasure_copies;
    DROP TABLE person_erasure_scope;
    DROP TABLE staff_operation_order;
    DROP INDEX merges_copy_history;
    ALTER TABLE people DROP COLUMN erased_at;
    ALTER TABLE merges DROP COLUMN erased_at;
    DELETE FROM d1_migrations WHERE name='0024_person_erasure.sql';`);
  const previousMerge = readFileSync(
    new URL('../migrations/0012_corrections_and_merges.sql', import.meta.url),
    'utf8',
  );
  f.db.raw.exec(
    previousMerge.slice(previousMerge.indexOf('CREATE TRIGGER merges_bookkeeping_immutable')),
  );
  const previousAudit = /CREATE TRIGGER staff_audit_append_only[\s\S]*?END;/.exec(
    readFileSync(new URL('../migrations/0010_staff_authorization.sql', import.meta.url), 'utf8'),
  )?.[0];
  assert.ok(previousAudit);
  f.db.raw.exec(previousAudit);
  const order = f.db.raw.prepare('SELECT operation_id FROM staff_operations ORDER BY rowid').all();
  applyMigrations(f.db.raw);
  assert.deepEqual(
    f.db.raw.prepare('SELECT operation_id FROM staff_operation_order ORDER BY sequence').all(),
    order,
  );
  assert.equal(
    (
      await f.undoMerge(f.db, f.actor, {
        mergeId: combined.value.mergeId,
        reason: 'Separate people after upgrade',
        operationId: 'legacy-undo',
      })
    ).kind,
    'ok',
  );
  assert.equal((await f.people.getPerson(f.merged.id))?.phone, '+17025550100');
  assert.equal((await f.people.getPerson(f.survivor.id))?.phone, null);
  f.db.raw.close();
});
