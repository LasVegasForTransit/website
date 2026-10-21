import assert from 'node:assert/strict';
import test from 'node:test';
import { ready, now, operation } from './support/task-checkins';
import { loadActor } from '../src/staff-roles';
async function fixture() {
  const f = await ready();
  f.db.raw
    .prepare("UPDATE people SET membership_status='member' WHERE id IN ('staff','guest')")
    .run();
  for (const id of ['staff', 'guest'])
    f.db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES(?,'staff',?)",
      )
      .run(id, now.toISOString());
  const actor = await loadActor(f.db, 'staff');
  assert.ok(actor);
  await f.s.recordTaskInteraction(f.db, operation, now);
  f.db.raw
    .prepare("UPDATE task_checkin_operations SET state='held',reason='unconfirmed_effect'")
    .run();
  const api = await import('../src/notion-task-recovery').catch(() => null);
  assert.ok(api, 'durable staff recovery must exist');
  const input = {
    sourceId: 'source',
    operationId: operation.id,
    expectedUpdatedAt: now.toISOString(),
  };
  return { ...f, actor, api, input };
}
void test('recovery can check a paused source without allowing another comment write', async () => {
  const f = await fixture();
  try {
    f.db.raw.prepare('UPDATE task_checkin_sources SET enabled=0').run();
    assert.equal(await f.api.requestTaskCommentRecovery(f.db, f.actor, f.input, now), true);
    const claim = await f.api.claimTaskCommentRecovery(f.db, 'source', now);
    assert.ok(claim);
    assert.equal(await f.api.finishTaskCommentRecovery(f.db, claim, null, now), true);
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_operations').get()?.state,
      'held',
    );
    assert.equal(await f.api.requestTaskCommentRecovery(f.db, f.actor, f.input, now), true);
    const second = await f.api.claimTaskCommentRecovery(f.db, 'source', now);
    assert.ok(second);
    assert.equal(
      await f.api.finishTaskCommentRecovery(f.db, second, 'verified-comment', now),
      true,
    );
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_operations').get()?.state,
      'confirmed',
    );
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM staff_audits').get()?.n, 3);
    assert.equal(await f.api.requestTaskCommentRecovery(f.db, f.actor, f.input, now), false);
  } finally {
    f.db.raw.close();
  }
});
void test('closing a held update cancels an in-flight check and never claims that Notion was updated', async () => {
  const f = await fixture();
  try {
    await f.api.requestTaskCommentRecovery(f.db, f.actor, f.input, now);
    const claim = await f.api.claimTaskCommentRecovery(f.db, 'source', now);
    assert.ok(claim);
    assert.equal(await f.api.closeHeldTaskUpdate(f.db, f.actor, f.input, now), true);
    assert.equal(await f.api.finishTaskCommentRecovery(f.db, claim, 'late-comment', now), false);
    const row = f.db.raw
      .prepare('SELECT state,reason,result_json FROM task_checkin_operations')
      .get();
    assert.equal(row?.state, 'superseded');
    assert.equal(row.reason, 'staff_closed');
    assert.equal(row.result_json, null);
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_recovery').get()?.state,
      'superseded',
    );
  } finally {
    f.db.raw.close();
  }
});
void test('revoked administrator and subject erasure fence recovery confirmation', async () => {
  const f = await fixture();
  try {
    await f.api.requestTaskCommentRecovery(f.db, f.actor, f.input, now);
    const claim = await f.api.claimTaskCommentRecovery(f.db, 'source', now);
    assert.ok(claim);
    f.db.raw.prepare("DELETE FROM staff_administrators WHERE person_id='staff'").run();
    assert.equal(await f.api.finishTaskCommentRecovery(f.db, claim, 'comment', now), false);
    assert.equal(await f.api.requestTaskCommentRecovery(f.db, f.actor, f.input, now), false);
    assert.equal(await f.api.claimTaskCommentRecovery(f.db, 'source', now), null);
    f.db.raw
      .prepare("UPDATE people SET deleted_at=?,erased_at=? WHERE id='member'")
      .run(now.toISOString(), now.toISOString());
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM task_checkin_recovery').get()?.n, 0);
  } finally {
    f.db.raw.close();
  }
});
void test('interrupted recovery checks retry with bounded attempts and audit failures roll back close', async () => {
  const f = await fixture();
  try {
    await f.api.requestTaskCommentRecovery(f.db, f.actor, f.input, now);
    const claim = await f.api.claimTaskCommentRecovery(f.db, 'source', now);
    assert.ok(claim);
    const retry = await f.api.claimTaskCommentRecovery(
      f.db,
      'source',
      new Date(now.getTime() + 91_000),
    );
    assert.ok(retry);
    assert.equal(retry.recovery_attempts, 2);
    assert.equal(await f.api.finishTaskCommentRecovery(f.db, claim, 'late', now), false);
    f.db.raw.exec(
      "CREATE TRIGGER reject_recovery_audit BEFORE INSERT ON staff_audits BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;",
    );
    await assert.rejects(
      f.api.closeHeldTaskUpdate(f.db, f.actor, f.input, now),
      /audit unavailable/,
    );
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_operations').get()?.state,
      'held',
    );
    f.db.raw.prepare('UPDATE task_checkin_recovery SET attempts=3').run();
    assert.equal(
      await f.api.claimTaskCommentRecovery(f.db, 'source', new Date(now.getTime() + 182_000)),
      null,
    );
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_recovery').get()?.state,
      'failed',
    );
  } finally {
    f.db.raw.close();
  }
});
