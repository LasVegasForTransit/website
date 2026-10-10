import assert from 'node:assert/strict';
import test from 'node:test';
import { correctPerson } from '../src/corrections';
import { mergeFixture } from './support/merge-fixture';

void test('erasure removes third-party review copies without disabling another live combination', async () => {
  const f = await mergeFixture();
  const third = await f.create('erase-third@example.invalid', 'Third member');
  f.db.raw
    .prepare(
      `INSERT INTO review_queue(id,candidate_person_id,existing_person_id,reason,created_at,updated_at,details)
    VALUES('third-review',?,?,'possible_duplicate','2026-01-01','2026-01-01',?)`,
    )
    .run(third.id, f.merged.id, JSON.stringify({ email: 'erase-third@example.invalid' }));
  const combined = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(combined.kind, 'ok');
  assert.ok(
    String(
      f.db.raw.prepare('SELECT moved_rows FROM merges WHERE id=?').get(combined.value.mergeId)
        ?.moved_rows,
    ).includes('erase-third@example.invalid'),
  );
  await f.people.deletePerson(third.id);
  const archive = f.db.raw
    .prepare('SELECT moved_rows,erased_at FROM merges WHERE id=?')
    .get(combined.value.mergeId);
  assert.equal(String(archive?.moved_rows).includes('erase-third@example.invalid'), false);
  assert.equal(archive?.erased_at, null);
  assert.equal((await f.people.getPerson(f.survivor.id))?.given_name, 'Survivor');
  assert.equal(
    (
      await f.undoMerge(f.db, f.actor, {
        mergeId: combined.value.mergeId,
        reason: 'Different people',
        operationId: 'undo-after-review-erasure',
      })
    ).kind,
    'ok',
  );
  assert.equal((await f.people.getPerson(f.merged.id))?.phone, '+17025550100');
  assert.equal(
    f.db.raw.prepare("SELECT 1 FROM review_queue WHERE id='third-review'").get(),
    undefined,
  );
  f.db.raw.close();
});

void test('deletion clears full-profile correction results saved before a later separation', async () => {
  const f = await mergeFixture();
  const combined = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(combined.kind, 'ok');
  assert.equal(
    (
      await correctPerson(f.db, f.actor, f.survivor.id, {
        fields: { family_name: 'Separate retained field' },
        reason: 'Member confirmed their name',
        operationId: 'postmerge-correction',
      })
    ).kind,
    'ok',
  );
  assert.ok(
    String(
      f.db.raw
        .prepare("SELECT result FROM staff_operations WHERE operation_id='postmerge-correction'")
        .get()?.result,
    ).includes('+17025550100'),
  );
  assert.equal(
    (
      await f.undoMerge(f.db, f.actor, {
        mergeId: combined.value.mergeId,
        reason: 'Separate people',
        operationId: 'separation-for-erasure',
      })
    ).kind,
    'ok',
  );
  await f.people.deletePerson(f.merged.id);
  assert.equal(
    f.db.raw
      .prepare("SELECT result FROM staff_operations WHERE operation_id='postmerge-correction'")
      .get()?.result,
    null,
  );
  assert.equal((await f.people.getPerson(f.survivor.id))?.family_name, 'Separate retained field');
  assert.equal((await f.people.getPerson(f.survivor.id))?.phone, null);
  assert.equal(
    f.db.raw
      .prepare('SELECT count(*) AS n FROM person_corrections WHERE person_id=?')
      .get(f.survivor.id)?.n,
    1,
  );
  assert.equal(
    (
      await correctPerson(f.db, f.actor, f.survivor.id, {
        fields: { family_name: 'Separate retained field' },
        reason: 'Member confirmed their name',
        operationId: 'postmerge-correction',
      })
    ).kind,
    'conflict',
  );
  f.db.raw.close();
});

void test('ended merge chains erase transitive snapshots while preserving separated live profiles', async () => {
  const f = await mergeFixture();
  const inner = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(inner.kind, 'ok');
  const third = (
    await f.people.upsertFromSource({ source: 'paper', fields: { given_name: 'Third member' } })
  ).person;
  const outer = await f.mergePeople(f.db, f.actor, {
    ...f.input,
    survivorId: third.id,
    mergedId: f.survivor.id,
    operationId: 'outer-merge',
  });
  assert.equal(outer.kind, 'ok');
  assert.equal(
    (
      await correctPerson(f.db, f.actor, third.id, {
        fields: { family_name: 'Keep this correction' },
        reason: 'Member confirmed',
        operationId: 'nested-correction',
      })
    ).kind,
    'ok',
  );
  for (const [id, operationId] of [
    [outer.value.mergeId, 'undo-outer'],
    [inner.value.mergeId, 'undo-inner'],
  ] as const)
    assert.equal(
      (await f.undoMerge(f.db, f.actor, { mergeId: id, reason: 'Separate members', operationId }))
        .kind,
      'ok',
    );
  assert.ok(
    String(
      f.db.raw.prepare('SELECT moved_rows FROM merges WHERE id=?').get(outer.value.mergeId)
        ?.moved_rows,
    ).includes('+17025550100'),
  );
  await f.people.deletePerson(f.merged.id);
  assert.equal(
    f.db.raw.prepare('SELECT moved_rows FROM merges WHERE id=?').get(outer.value.mergeId)
      ?.moved_rows,
    '{}',
  );
  assert.equal(
    f.db.raw
      .prepare("SELECT result FROM staff_operations WHERE operation_id='nested-correction'")
      .get()?.result,
    null,
  );
  assert.equal((await f.people.getPerson(third.id))?.family_name, 'Keep this correction');
  assert.equal((await f.people.getPerson(third.id))?.phone, null);
  assert.equal((await f.people.getPerson(f.survivor.id))?.given_name, 'Survivor');
  f.db.raw.close();
});

void test('historical paths stop at a completed separation and preserve a later live combination', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2090-01-01T00:00:00Z') });
  const f = await mergeFixture();
  const inner = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(inner.kind, 'ok');
  context.mock.timers.setTime(Date.parse('2090-01-02T00:00:00Z'));
  assert.equal(
    (
      await f.undoMerge(f.db, f.actor, {
        mergeId: inner.value.mergeId,
        reason: 'Separate people',
        operationId: 'earlier-separation',
      })
    ).kind,
    'ok',
  );
  context.mock.timers.setTime(Date.parse('2090-01-03T00:00:00Z'));
  const third = (
    await f.people.upsertFromSource({ source: 'paper', fields: { given_name: 'Later member' } })
  ).person;
  const outer = await f.mergePeople(f.db, f.actor, {
    ...f.input,
    survivorId: third.id,
    mergedId: f.survivor.id,
    operationId: 'later-combination',
  });
  assert.equal(outer.kind, 'ok');
  await correctPerson(f.db, f.actor, third.id, {
    fields: { family_name: 'Later correction' },
    reason: 'Member confirmed',
    operationId: 'later-live-correction',
  });
  const before = f.db.raw
    .prepare('SELECT moved_rows FROM merges WHERE id=?')
    .get(outer.value.mergeId)?.moved_rows;
  const receipt = f.db.raw
    .prepare("SELECT result FROM staff_operations WHERE operation_id='later-live-correction'")
    .get()?.result;
  context.mock.timers.setTime(Date.parse('2090-01-04T00:00:00Z'));
  await f.people.deletePerson(f.merged.id);
  assert.equal(
    f.db.raw.prepare('SELECT moved_rows FROM merges WHERE id=?').get(outer.value.mergeId)
      ?.moved_rows,
    before,
  );
  assert.equal(
    f.db.raw
      .prepare("SELECT result FROM staff_operations WHERE operation_id='later-live-correction'")
      .get()?.result,
    receipt,
  );
  assert.equal(
    (
      await f.undoMerge(f.db, f.actor, {
        mergeId: outer.value.mergeId,
        reason: 'Restore later entries',
        operationId: 'restore-later',
      })
    ).kind,
    'ok',
  );
  f.db.raw.close();
});

for (const nested of [false, true])
  void test(`equal clocks preserve ${nested ? 'nested copy erasure' : 'a later independent live merge'}`, async (context) => {
    context.mock.timers.enable({ apis: ['Date'], now: new Date('2090-01-01T00:00:00Z') });
    const f = await mergeFixture();
    const inner = await f.mergePeople(f.db, f.actor, f.input);
    assert.equal(inner.kind, 'ok');
    const third = (
      await f.people.upsertFromSource({
        source: 'paper',
        fields: { given_name: 'Equal clock member' },
      })
    ).person;
    const undoInner = () =>
      f.undoMerge(f.db, f.actor, {
        mergeId: inner.value.mergeId,
        reason: 'Different members',
        operationId: 'equal-inner-undo',
      });
    if (!nested) assert.equal((await undoInner()).kind, 'ok');
    const outer = await f.mergePeople(f.db, f.actor, {
      ...f.input,
      survivorId: third.id,
      mergedId: f.survivor.id,
      operationId: 'equal-outer-merge',
    });
    assert.equal(outer.kind, 'ok');
    await correctPerson(f.db, f.actor, third.id, {
      fields: { family_name: 'Current correction' },
      reason: 'Confirmed',
      operationId: 'equal-correction',
    });
    if (nested) {
      assert.equal(
        (
          await f.undoMerge(f.db, f.actor, {
            mergeId: outer.value.mergeId,
            reason: 'Different members',
            operationId: 'equal-outer-undo',
          })
        ).kind,
        'ok',
      );
      assert.equal((await undoInner()).kind, 'ok');
    }
    const before = f.db.raw
      .prepare('SELECT moved_rows FROM merges WHERE id=?')
      .get(outer.value.mergeId)?.moved_rows;
    await f.people.deletePerson(f.merged.id);
    assert.equal(
      f.db.raw.prepare('SELECT moved_rows FROM merges WHERE id=?').get(outer.value.mergeId)
        ?.moved_rows,
      nested ? '{}' : before,
    );
    if (!nested)
      assert.equal(
        (
          await f.undoMerge(f.db, f.actor, {
            mergeId: outer.value.mergeId,
            reason: 'Undo still available',
            operationId: 'equal-later-undo',
          })
        ).kind,
        'ok',
      );
    const result = f.db.raw
      .prepare("SELECT result FROM staff_operations WHERE operation_id='equal-correction'")
      .get()?.result;
    if (nested) assert.equal(result, null);
    else assert.ok(result);
    f.db.raw.close();
  });

void test('operation ordering survives clock rollback and never reuses a removed receipt order', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2090-01-01T00:00:00Z') });
  const f = await mergeFixture();
  const inner = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(inner.kind, 'ok');
  context.mock.timers.setTime(Date.parse('2080-01-01T00:00:00Z'));
  const third = (
    await f.people.upsertFromSource({
      source: 'paper',
      fields: { given_name: 'Clock rollback member' },
    })
  ).person;
  const outer = await f.mergePeople(f.db, f.actor, {
    ...f.input,
    survivorId: third.id,
    mergedId: f.survivor.id,
    operationId: 'rollback-outer-merge',
  });
  assert.equal(outer.kind, 'ok');
  for (const [mergeId, operationId] of [
    [outer.value.mergeId, 'rollback-undo-outer'],
    [inner.value.mergeId, 'rollback-undo-inner'],
  ] as const)
    assert.equal(
      (await f.undoMerge(f.db, f.actor, { mergeId, operationId, reason: 'Different members' }))
        .kind,
      'ok',
    );
  await f.people.deletePerson(f.merged.id);
  assert.equal(
    f.db.raw.prepare('SELECT moved_rows FROM merges WHERE id=?').get(outer.value.mergeId)
      ?.moved_rows,
    '{}',
  );
  assert.throws(
    () => f.db.raw.exec('UPDATE staff_operation_order SET sequence=sequence+100'),
    /order cannot/,
  );
  assert.throws(() => f.db.raw.exec('DELETE FROM staff_operation_order'), /order follows/);
  f.db.raw
    .prepare(
      "INSERT INTO staff_operations(operation_id,actor_id,kind,target_id,payload,created_at) VALUES('temporary',?,'fixture',?,'{}',?)",
    )
    .run(f.admin.id, f.admin.id, new Date().toISOString());
  const previous = Number(
    f.db.raw
      .prepare("SELECT sequence FROM staff_operation_order WHERE operation_id='temporary'")
      .get()?.sequence,
  );
  f.db.raw.exec("DELETE FROM staff_operations WHERE operation_id='temporary'");
  f.db.raw
    .prepare(
      "INSERT INTO staff_operations(operation_id,actor_id,kind,target_id,payload,created_at) VALUES('later',?,'fixture',?,'{}',?)",
    )
    .run(f.admin.id, f.admin.id, new Date().toISOString());
  assert.ok(
    Number(
      f.db.raw
        .prepare("SELECT sequence FROM staff_operation_order WHERE operation_id='later'")
        .get()?.sequence,
    ) > previous,
  );
  f.db.raw.close();
});
