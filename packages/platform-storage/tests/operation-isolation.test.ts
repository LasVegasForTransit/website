import assert from 'node:assert/strict';
import test from 'node:test';
import { correctPerson } from '../src/corrections';
import { keepSeparate } from '../src/reviews';
import { updateCommitteeSettings } from '../src/committee-settings';
import { mergeFixture } from './support/merge-fixture';

for (const action of ['merge', 'undo', 'correction', 'review', 'settings'])
  void test(`${action} completion preserves every unrelated saved result and replay`, async () => {
    const f = await mergeFixture();
    const original = await correctPerson(f.db, f.actor, f.admin.id, {
      fields: { family_name: 'Admin unchanged by another operation' },
      reason: 'Confirmed by the member',
      operationId: 'original-correction',
    });
    assert.equal(original.kind, 'ok');
    let mergeId = '';
    if (action === 'undo') {
      const merged = await f.mergePeople(f.db, f.actor, f.input);
      assert.equal(merged.kind, 'ok');
      mergeId = merged.value.mergeId;
    }
    f.db.raw
      .prepare(
        `INSERT INTO review_queue(id,candidate_person_id,existing_person_id,reason,created_at,updated_at)
      VALUES('separate-review',?,?,'possible_duplicate','2026-01-01','2026-01-01')`,
      )
      .run(f.survivor.id, f.merged.id);
    const before = f.db.raw.prepare('SELECT * FROM staff_operations ORDER BY operation_id').all();
    const run = async () => {
      if (action === 'merge') return f.mergePeople(f.db, f.actor, f.input);
      if (action === 'undo')
        return f.undoMerge(f.db, f.actor, {
          mergeId,
          reason: 'Different people',
          operationId: 'isolated-undo',
        });
      if (action === 'correction')
        return correctPerson(f.db, f.actor, f.survivor.id, {
          fields: { family_name: 'A separate change' },
          reason: 'Member confirmed',
          operationId: 'isolated-correction',
        });
      if (action === 'review')
        return keepSeparate(f.db, f.actor, 'separate-review', {
          note: 'Different members',
          operationId: 'isolated-review',
        });
      return updateCommitteeSettings(f.db, f.actor, 'events', {
        description: 'Organize events',
        timeCommitment: 'Two hours a month',
        acceptingMembers: true,
        workspaceGroupEmail: null,
        discordRoleId: null,
        interestIds: ['events'],
        expectedVersion: 1,
        operationId: 'isolated-settings',
      });
    };
    const saved = await run();
    assert.equal(saved.kind, 'ok');
    for (const row of before)
      assert.deepEqual(
        f.db.raw
          .prepare('SELECT * FROM staff_operations WHERE operation_id=?')
          .get(String(row.operation_id)),
        row,
        `unrelated receipt ${String(row.operation_id)}`,
      );
    assert.deepEqual(await run(), saved);
    assert.deepEqual(
      await correctPerson(f.db, f.actor, f.admin.id, {
        fields: { family_name: 'Admin unchanged by another operation' },
        reason: 'Confirmed by the member',
        operationId: 'original-correction',
      }),
      original,
    );
    f.db.raw.close();
  });
