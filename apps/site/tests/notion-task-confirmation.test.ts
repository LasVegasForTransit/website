import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ensureTaskCard,
  attachTaskCardMessage,
} from '@lasvegasfortransit/platform-storage/notion-task-cards';
import {
  fixture,
  sourceId,
  userId,
  channelId,
  messageId,
  now,
} from './support/task-checkin-interaction-fixture';

void test('native confirmation and cancel use their separate signed ephemeral message context', async () => {
  const f = await fixture();
  try {
    await f.consent();
    const card = await ensureTaskCard(f.db, { sourceId, taskId: 'task', personId: 'member' }, now);
    assert.ok(card);
    await attachTaskCardMessage(f.db, { token: card.token, channelId, messageId }, now);
    const base = { type: 3, user: { id: userId }, channel_id: channelId };
    const prompt = await f.send({
      ...base,
      id: '888888888888888880',
      message: { id: messageId },
      data: { custom_id: `tc:${card.token}:complete` },
    });
    assert.equal(prompt.status, 200);
    assert.equal((await prompt.json<{ data: { flags: number } }>()).data.flags & 64, 64);
    const confirmation = { ...base, message: { id: '555555555555555556', flags: 64 } };
    const cancel = await f.send({
      ...confirmation,
      id: '888888888888888881',
      data: { custom_id: `tc:${card.token}:cancel` },
    });
    assert.match(JSON.stringify(await cancel.json()), /No change was made/);
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM task_checkin_operations').get()?.n, 0);
    const forgedContext = await f.send({
      ...base,
      id: '888888888888888882',
      message: { id: messageId },
      data: { custom_id: `tc:${card.token}:confirm` },
    });
    assert.match(JSON.stringify(await forgedContext.json()), /changed/i);
    const wrongActor = await f.send({
      ...confirmation,
      id: '888888888888888883',
      user: { id: '333333333333333334' },
      data: { custom_id: `tc:${card.token}:confirm` },
    });
    assert.equal(wrongActor.status, 403);
    const confirm = await f.send({
      ...confirmation,
      id: '888888888888888884',
      data: { custom_id: `tc:${card.token}:confirm` },
    });
    assert.match(JSON.stringify(await confirm.json()), /waiting to be saved/i);
    assert.equal(
      f.db.raw
        .prepare("SELECT count(*) AS n FROM task_checkin_operations WHERE kind='complete'")
        .get()?.n,
      1,
    );
  } finally {
    f.db.raw.close();
  }
});
