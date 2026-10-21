import assert from 'node:assert/strict';
import test from 'node:test';
import { upsertNotionTaskSnapshot } from '@lasvegasfortransit/platform-storage/notion-task-checkins';
import {
  ensureTaskCard,
  attachTaskCardMessage,
} from '@lasvegasfortransit/platform-storage/notion-task-cards';
import {
  fixture,
  sourceId,
  guildId,
  userId,
  channelId,
  messageId,
  now,
} from './support/task-checkin-interaction-fixture';

void test('signed setup shows policy before any consent and only an explicit self-authored choice enables messages', async () => {
  const f = await fixture();
  try {
    const setup = await f.send({
      type: 2,
      id: '666666666666666665',
      guild_id: guildId,
      data: { name: 'checkins' },
      member: { user: { id: userId } },
    });
    assert.equal(setup.status, 200);
    assert.match(JSON.stringify(await setup.json()), /21:00/);
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM task_checkin_consents').get()?.n, 0);
    assert.equal((await f.consent()).status, 200);
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_consents').get()?.state,
      'active',
    );
    assert.equal(
      f.db.raw.prepare("SELECT membership_status FROM people WHERE id='member'").get()
        ?.membership_status,
      'not_member',
    );
    await f.send({
      type: 3,
      id: '666666666666666667',
      guild_id: guildId,
      member: { user: { id: userId } },
      data: { custom_id: `tcs:${sourceId}:1:opted_out` },
    });
    await f.consent();
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_consents').get()?.state,
      'opted_out',
    );
  } finally {
    f.db.raw.close();
  }
});

void test('signed private modal submissions are durable before acknowledgment and replay without duplicate writes', async () => {
  const f = await fixture();
  try {
    await f.consent();
    const card = await ensureTaskCard(f.db, { sourceId, taskId: 'task', personId: 'member' }, now);
    assert.ok(card);
    await attachTaskCardMessage(f.db, { token: card.token, channelId, messageId }, now);
    const button = await f.send({
      type: 3,
      id: '777777777777777770',
      user: { id: userId },
      channel_id: channelId,
      message: { id: messageId },
      data: { custom_id: `tc:${card.token}:progress` },
    });
    assert.equal((await button.json<{ type: number }>()).type, 9);
    const submission = {
      type: 5,
      id: '777777777777777771',
      user: { id: userId },
      channel_id: channelId,
      data: {
        custom_id: `tc:${card.token}:progress`,
        components: [{ type: 18, component: { type: 4, custom_id: 'note', value: 'Draft ready' } }],
      },
    };
    const started = performance.now();
    const response = await f.send(submission);
    assert.ok(performance.now() - started < 3000);
    assert.equal(response.status, 200);
    assert.match(JSON.stringify(await response.json()), /waiting to be saved/);
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_operations').get()?.state,
      'queued',
    );
    await f.send(submission);
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM task_checkin_operations').get()?.n, 1);
  } finally {
    f.db.raw.close();
  }
});

void test('other actors, shared channels, stale cards, expired signatures, and disabled deployments cannot submit task updates', async () => {
  const f = await fixture();
  try {
    await f.consent();
    const card = await ensureTaskCard(f.db, { sourceId, taskId: 'task', personId: 'member' }, now);
    assert.ok(card);
    await attachTaskCardMessage(f.db, { token: card.token, channelId, messageId }, now);
    const button = {
      type: 3,
      id: '777777777777777772',
      user: { id: userId },
      channel_id: channelId,
      message: { id: messageId },
      data: { custom_id: `tc:${card.token}:confirm` },
    };
    assert.equal((await f.send({ ...button, user: { id: '888888888888888888' } })).status, 403);
    await upsertNotionTaskSnapshot(
      f.db,
      {
        sourceId,
        taskId: 'task',
        revision: 'v2',
        sourceEditedAt: now.toISOString(),
        active: true,
        snapshot: { assigneeIds: ['notion-member'], title: 'Private changed task' },
      },
      now,
    );
    // Rotate the real reference, rather than only simulating a mismatched message ID.
    f.db.raw
      .prepare('UPDATE task_checkin_cards SET token=? WHERE token=?')
      .run('z'.repeat(43), card.token);
    for (const action of ['confirm', 'progress', 'preferences']) {
      const retired = await f.send({
        ...button,
        data: { custom_id: `tc:${card.token}:${action}` },
      });
      assert.equal(retired.status, 200);
      const reply = JSON.stringify(await retired.json());
      assert.match(reply, /changed/);
      assert.equal(reply.includes('Private changed task'), false);
    }
    assert.equal((await f.send({ ...button, channel_id: '444444444444444445' })).status, 403);
    assert.equal((await f.send({ ...button, user: { id: '888888888888888888' } })).status, 403);
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM task_checkin_operations').get()?.n, 0);
    assert.equal(
      (await f.send({ ...button, guild_id: guildId, member: { user: { id: userId } } })).status,
      403,
    );
    assert.equal((await f.send(button, '1')).status, 401);
    await upsertNotionTaskSnapshot(
      f.db,
      {
        sourceId,
        taskId: 'task',
        revision: 'v2',
        sourceEditedAt: now.toISOString(),
        active: false,
        snapshot: { assigneeIds: [] },
      },
      now,
    );
    const stale = await f.send(button);
    assert.match(JSON.stringify(await stale.json()), /changed/);
    f.env.LVBT_TASK_CHECKINS_ENABLED = 'false';
    assert.equal((await f.send(button)).status, 404);
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM task_checkin_operations').get()?.n, 0);
  } finally {
    f.db.raw.close();
  }
});

void test('a volunteer can stop check-ins even after the source policy becomes incomplete', async () => {
  const f = await fixture();
  try {
    await f.consent();
    f.db.raw
      .prepare("UPDATE task_checkin_sources SET policy_json='{}',revision=revision+1 WHERE id=?")
      .run(sourceId);
    const stopped = await f.send({
      type: 3,
      id: '666666666666666668',
      guild_id: guildId,
      member: { user: { id: userId } },
      data: { custom_id: `tcs:${sourceId}:1:opted_out` },
    });
    assert.equal(stopped.status, 200);
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_consents').get()?.state,
      'opted_out',
    );
  } finally {
    f.db.raw.close();
  }
});

void test('an older private reminder explains that it changed without accepting an update', async () => {
  const f = await fixture();
  try {
    await f.consent();
    const card = await ensureTaskCard(f.db, { sourceId, taskId: 'task', personId: 'member' }, now);
    assert.ok(card);
    await attachTaskCardMessage(
      f.db,
      { token: card.token, channelId, messageId: '555555555555555556' },
      now,
    );
    const button = {
      type: 3,
      id: '777777777777777779',
      user: { id: userId },
      channel_id: channelId,
      message: { id: messageId },
      data: { custom_id: `tc:${card.token}:confirm` },
    };
    const stale = await f.send(button);
    assert.equal(stale.status, 200);
    assert.match(JSON.stringify(await stale.json()), /changed/);
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM task_checkin_operations').get()?.n, 0);
    assert.equal((await f.send({ ...button, channel_id: '444444444444444445' })).status, 403);
    assert.equal((await f.send({ ...button, user: { id: '888888888888888888' } })).status, 403);
  } finally {
    f.db.raw.close();
  }
});
