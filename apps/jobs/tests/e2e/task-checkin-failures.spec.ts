import assert from 'node:assert/strict';
import { taskRuntime } from './support/task-checkins';
import { loadActor } from '@lasvegasfortransit/platform-storage/staff-roles';
import {
  taskCheckinReview,
  retryTaskCheckinOperation,
} from '@lasvegasfortransit/platform-storage/notion-task-admin';
import { requestTaskCommentRecovery } from '@lasvegasfortransit/platform-storage/notion-task-recovery';

type Fixture = Awaited<ReturnType<typeof taskRuntime>>;
type Account = Fixture['accounts'][number];
async function optIn(f: Fixture, account: Account) {
  const response = await f.signed({
    type: 3,
    guild_id: f.guildId,
    member: { user: { id: account.user } },
    data: { custom_id: `tcs:${f.sourceId}:1:active` },
  });
  assert.equal(response.status, 200);
}
async function card(f: Fixture, account: Account) {
  const row = await f.db
    .prepare('SELECT token FROM task_checkin_cards WHERE person_id=?')
    .bind(account.person)
    .first<{ token: string }>();
  assert.ok(row);
  return row.token;
}
async function respond(f: Fixture, account: Account, token: string) {
  const response = await f.signed({
    type: 5,
    user: { id: account.user },
    channel_id: account.channel,
    data: {
      custom_id: `tc:${token}:progress`,
      components: [
        { type: 18, component: { type: 4, custom_id: 'note', value: 'Private trial update' } },
      ],
    },
  });
  assert.equal(response.status, 200);
  return response;
}
async function rescan(f: Fixture) {
  await f.db.prepare("UPDATE task_checkin_scans SET next_attempt_at='2020-01-01T00:00:00Z'").run();
  return f.steps.scan.run();
}
async function releaseCooldown(f: Fixture) {
  // Move the fixture's durable provider deadline forward; never sleep or pretend an effect succeeded.
  await f.db
    .prepare("UPDATE task_checkin_provider_backoffs SET not_before='2020-01-01T00:00:00Z'")
    .run();
}
async function scanFailure() {
  const f = await taskRuntime();
  try {
    assert.equal((await f.steps.scan.run()).kind, 'scanned');
    f.faults.scan = 'partial';
    const partial = await rescan(f);
    assert.equal(partial.kind, 'scanned');
    assert.equal(
      (await f.db.prepare('SELECT state FROM task_checkin_scans').first())?.state,
      'scanning',
    );
    assert.equal(
      (await f.db.prepare('SELECT count(*) AS n FROM task_checkin_tasks WHERE active=1').first())
        ?.n,
      2,
    );
    f.faults.scan = 'failed';
    assert.equal((await f.steps.scan.run()).kind, 'failed');
    assert.equal(
      (await f.db.prepare('SELECT reason FROM task_checkin_scans').first())?.reason,
      'http_503',
    );
    assert.equal(
      (await f.db.prepare('SELECT count(*) AS n FROM task_checkin_tasks WHERE active=1').first())
        ?.n,
      2,
      'an interrupted scan cannot remove an unseen guest task',
    );
    const actor = await loadActor(f.db, 'staff');
    assert.ok(actor);
    const review = await taskCheckinReview(f.db, actor, f.sourceId);
    assert.equal(review.source?.scan_reason, 'http_503');
    f.faults.scan = 'complete';
    await releaseCooldown(f);
    assert.equal((await rescan(f)).kind, 'scanned');
    assert.equal(
      (await f.db.prepare('SELECT state FROM task_checkin_scans').first())?.state,
      'complete',
    );
    assert.equal(f.sends.length, 0);
  } finally {
    await f.dispose();
  }
}
async function blockedDM() {
  const f = await taskRuntime();
  try {
    const guest = f.accounts[1];
    assert.ok(guest);
    await f.steps.scan.run();
    await optIn(f, guest);
    f.faults.blockedUser = guest.user;
    assert.equal((await f.steps.queue.run()).queued, 1);
    await f.steps.operation.run();
    const actor = await loadActor(f.db, 'staff');
    assert.ok(actor);
    const review = await taskCheckinReview(f.db, actor, f.sourceId);
    const failed = review.operations.items[0];
    assert.ok(failed);
    assert.equal(failed.state, 'failed');
    assert.equal(failed.reason, 'permission_denied');
    assert.equal(failed.safe_retry, 1);
    assert.equal(f.sends.length, 0, 'blocked DMs never fall back to a public channel');
    const guestActor = await loadActor(f.db, guest.person);
    assert.ok(guestActor);
    await assert.rejects(taskCheckinReview(f.db, guestActor, f.sourceId), /access/);
    f.faults.blockedUser = null;
    assert.equal(
      await retryTaskCheckinOperation(
        f.db,
        actor,
        {
          sourceId: f.sourceId,
          operationId: failed.id,
          expectedUpdatedAt: failed.updated_at,
        },
        new Date(),
      ),
      true,
    );
    await f.steps.operation.run();
    await f.steps.operation.run();
    assert.equal(f.sends.length, 1);
    assert.equal(f.sends[0]?.recipient, guest.user);
    assert.equal((await taskCheckinReview(f.db, actor, f.sourceId)).operations.items.length, 0);
  } finally {
    await f.dispose();
  }
}
async function revokedDuringDM() {
  const f = await taskRuntime();
  try {
    const guest = f.accounts[1];
    assert.ok(guest);
    await f.steps.scan.run();
    await optIn(f, guest);
    await f.steps.queue.run();
    f.faults.beforeDM = async () => {
      const stop = await f.signed({
        type: 3,
        guild_id: f.guildId,
        member: { user: { id: guest.user } },
        data: { custom_id: `tcs:${f.sourceId}:1:opted_out` },
      });
      assert.equal(stop.status, 200);
    };
    await f.steps.operation.run();
    assert.equal(f.sends.length, 0, 'opt-out during channel creation fences the final send');
    assert.equal(
      (await f.db.prepare('SELECT state FROM task_checkin_operations').first())?.state,
      'superseded',
    );
    assert.equal((await f.steps.queue.run()).queued, 0);
  } finally {
    await f.dispose();
  }
}
async function staleAndRevokedActions() {
  const f = await taskRuntime();
  try {
    await f.steps.scan.run();
    for (const account of f.accounts) await optIn(f, account);
    await f.steps.queue.run();
    await f.steps.operation.run();
    await f.steps.operation.run();
    const member = f.accounts[0],
      guest = f.accounts[1],
      page = f.pages[0];
    assert.ok(member);
    assert.ok(guest);
    assert.ok(page);
    const oldToken = await card(f, member);
    await respond(f, member, oldToken);
    page.properties['Due date'].date.start = new Date(Date.now() + 6 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    page.last_edited_time = new Date().toISOString();
    await f.steps.operation.run();
    assert.equal(f.comments.length, 0, 'a fresh provider read rejects an outdated response');
    assert.equal(
      (
        await f.db
          .prepare(
            "SELECT state FROM task_checkin_operations WHERE person_id='member' AND kind='progress'",
          )
          .first()
      )?.state,
      'superseded',
    );
    await rescan(f);
    // Queueing evaluates the changed task and rotates controls without sending another reminder.
    await f.steps.queue.run();
    const stale = await respond(f, member, oldToken);
    const notice = JSON.stringify(await stale.json());
    assert.ok(!notice.includes('Private member task'));
    assert.ok(!notice.includes('Private guest task'));
    await respond(f, guest, await card(f, guest));
    await f.signed({
      type: 3,
      guild_id: f.guildId,
      member: { user: { id: guest.user } },
      data: { custom_id: `tcs:${f.sourceId}:1:opted_out` },
    });
    await f.steps.operation.run();
    assert.equal(f.comments.length, 0);
    assert.equal(
      (
        await f.db
          .prepare(
            "SELECT state FROM task_checkin_operations WHERE person_id='guest' AND kind='progress'",
          )
          .first()
      )?.state,
      'superseded',
    );
    assert.equal(
      (
        await f.db
          .prepare("SELECT count(*) AS n FROM task_checkin_operations WHERE kind='progress'")
          .first()
      )?.n,
      2,
    );
  } finally {
    await f.dispose();
  }
}
async function uncertainComment() {
  const f = await taskRuntime();
  try {
    const guest = f.accounts[1];
    assert.ok(guest);
    await f.steps.scan.run();
    await optIn(f, guest);
    await f.steps.queue.run();
    await f.steps.operation.run();
    await respond(f, guest, await card(f, guest));
    f.faults.ambiguousComment = true;
    await f.steps.operation.run();
    assert.equal(f.comments.length, 1);
    const actor = await loadActor(f.db, 'staff');
    assert.ok(actor);
    const review = await taskCheckinReview(f.db, actor, f.sourceId);
    const held = review.operations.items[0];
    assert.ok(held);
    assert.equal(held.state, 'held');
    assert.equal(held.can_reconcile, 1);
    assert.equal(held.safe_retry, 0);
    const input = {
      sourceId: f.sourceId,
      operationId: held.id,
      expectedUpdatedAt: held.updated_at,
    };
    assert.equal(await retryTaskCheckinOperation(f.db, actor, input, new Date()), false);
    await releaseCooldown(f);
    f.faults.visibleComments = false;
    assert.equal(await requestTaskCommentRecovery(f.db, actor, input, new Date()), true);
    await f.steps.recovery.run();
    assert.equal(
      (
        await f.db
          .prepare('SELECT state FROM task_checkin_operations WHERE id=?')
          .bind(held.id)
          .first()
      )?.state,
      'held',
      'absence from unresolved comments cannot authorize another write',
    );
    assert.equal(f.comments.length, 1);
    f.faults.visibleComments = true;
    assert.equal(await requestTaskCommentRecovery(f.db, actor, input, new Date()), true);
    await f.steps.recovery.run();
    await f.steps.operation.run();
    await f.steps.recovery.run();
    assert.equal(
      (
        await f.db
          .prepare('SELECT state FROM task_checkin_operations WHERE id=?')
          .bind(held.id)
          .first()
      )?.state,
      'confirmed',
    );
    assert.equal(
      f.comments.length,
      1,
      'positive bot-authored marker reconciliation never repeats POST',
    );
    assert.equal((await taskCheckinReview(f.db, actor, f.sourceId)).operations.items.length, 0);
    assert.equal(f.sends.length, 1);
  } finally {
    await f.dispose();
  }
}
async function disconnectedQueue() {
  const f = await taskRuntime();
  try {
    await f.steps.scan.run();
    for (const account of f.accounts) await optIn(f, account);
    await f.steps.queue.run();
    await f.steps.operation.run();
    await f.steps.operation.run();
    const member = f.accounts[0],
      guest = f.accounts[1];
    assert.ok(member);
    assert.ok(guest);
    await respond(f, member, await card(f, member));
    await respond(f, guest, await card(f, guest));
    await f.db
      .prepare(
        "INSERT INTO discord_disconnects(identity_record_id,operation_id,requested_at) VALUES('discord-member','begin-unlink',?)",
      )
      .bind(new Date().toISOString())
      .run();
    await f.steps.operation.run();
    await f.steps.operation.run();
    await f.steps.operation.run();
    assert.equal(
      f.comments.length,
      1,
      'a disconnected queue head cannot starve a valid guest response',
    );
    assert.equal((f.comments[0]?.parent as { page_id: string }).page_id, guest.task);
    assert.equal(
      (
        await f.db
          .prepare(
            "SELECT state FROM task_checkin_operations WHERE person_id='member' AND kind='progress'",
          )
          .first()
      )?.state,
      'superseded',
    );
  } finally {
    await f.dispose();
  }
}
await disconnectedQueue();
await scanFailure();
await blockedDM();
await revokedDuringDM();
await staleAndRevokedActions();
await uncertainComment();
console.log(
  'Compiled cross-worker failure and recovery scenarios passed. Provider APIs were simulated.',
);
