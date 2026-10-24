import assert from 'node:assert/strict';
import { Response } from 'miniflare';
import {
  ensureTaskCard,
  attachTaskCardMessage,
} from '@lasvegasfortransit/platform-storage/notion-task-cards';
import { taskRuntime } from './support/task-checkins';

const edits: unknown[] = [];
async function eventually(ready: () => boolean) {
  for (let attempt = 0; attempt < 100 && !ready(); attempt++)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(ready(), 'manual continuation completes');
}
const fixture = await taskRuntime({
  manualUpdatesOnly: true,
  workResponse: async (request, url) => {
    const match = /\/channels\/(\d+)\/messages\/(\d+)$/.exec(url.pathname);
    if (request.method !== 'PATCH' || !match) return null;
    edits.push(await request.json());
    return new Response(JSON.stringify({ id: match[2], channel_id: match[1] }));
  },
});
try {
  const { db, steps, accounts, sourceId, guildId, signed, comments, completions, sends } = fixture;
  assert.equal((await steps.scan.run()).kind, 'scanned');
  const account = accounts[0];
  assert.ok(account);
  await signed({
    type: 3,
    guild_id: guildId,
    member: { user: { id: account.user } },
    data: { custom_id: `tcs:${sourceId}:1:active` },
  });
  const card = await ensureTaskCard(
    db,
    { sourceId, taskId: account.task, personId: account.person },
    new Date(),
  );
  assert.ok(card);
  await attachTaskCardMessage(
    db,
    { token: card.token, channelId: account.channel, messageId: account.message },
    new Date(),
  );
  assert.equal((await steps.queue.run()).kind, 'idle', 'reminder scheduling remains off');
  await db
    .prepare(
      `INSERT INTO task_checkin_operations
    (id,source_id,task_id,person_id,task_revision,consent_revision,policy_revision,kind,payload_json,next_attempt_at,created_at,updated_at)
    SELECT 'pending-delivery',source_id,task_id,person_id,task_revision,consent_revision,policy_revision,'delivery','{}','','',''
    FROM task_checkin_cards`,
    )
    .run();
  const click = {
    type: 3,
    user: { id: account.user },
    channel_id: account.channel,
    message: { id: account.message },
  };
  const modal = await signed({ ...click, data: { custom_id: `tc:${card.token}:progress` } });
  assert.equal(((await modal.json()) as { type: number }).type, 9, 'Add update opens a modal');
  const note = await signed({
    ...click,
    type: 5,
    data: {
      custom_id: `tc:${card.token}:progress`,
      components: [{ type: 18, component: { type: 4, custom_id: 'note', value: 'Agenda ready' } }],
    },
  });
  assert.equal(note.status, 200);
  await eventually(() => comments.length === 1);
  assert.equal(comments.length, 1, 'manual note reaches Notion');
  assert.equal((await steps.operation.run()).kind, 'idle', 'queued reminder is excluded');
  await eventually(() => edits.length > 0);
  assert.ok(edits.length > 0, 'the existing card is refreshed');
  const status = await signed({
    ...click,
    data: { custom_id: `tc:${card.token}:status`, component_type: 3, values: ['Done'] },
  });
  assert.equal(status.status, 200);
  await eventually(() => completions.length === 1);
  assert.deepEqual(completions, [account.task], 'dropdown changes Notion status');
  assert.equal(sends.length, 0, 'no new Discord messages are sent');
  assert.equal(
    (
      await db
        .prepare("SELECT state FROM task_checkin_operations WHERE id='pending-delivery'")
        .first()
    )?.state,
    'superseded',
    'completing the task cancels its unsent reminder',
  );
  console.log(
    'Manual notes, status changes, and same-card refresh work with automated delivery disabled.',
  );
} finally {
  await fixture.dispose();
}
