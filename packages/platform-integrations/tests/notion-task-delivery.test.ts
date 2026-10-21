import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, page, sourceId } from './support/task-action-fixture';
import { NotionTaskClient } from '../src/notion-task-client';
import { DiscordTaskClient } from '../src/notion-task-discord';
import { taskPolicy } from './support/task-checkins';
const at = new Date('2026-10-23T18:00:00Z');
async function runtime() {
  const module = await import('../src/notion-task-delivery').catch(() => null);
  assert.ok(module, 'durable scheduled delivery must exist');
  return module;
}
void test('repeated schedules produce one intent and one confirmed private native card', async () => {
  const { queueTaskReminders, processTaskDelivery } = await runtime();
  const db = await fixture();
  db.raw.prepare('DELETE FROM task_checkin_operations').run();
  let sends = 0;
  const notion = new NotionTaskClient('token', () => Promise.resolve(Response.json(page())));
  const discord = new DiscordTaskClient({
    guildId: taskPolicy.guildId,
    botToken: 'token',
    fetch: (url, init) => {
      if (typeof url === 'string' && url.includes('/guilds/'))
        return Promise.resolve(
          Response.json({ user: { id: '111111111111111111', username: 'member' }, roles: [] }),
        );
      if (typeof url === 'string' && url.endsWith('/users/@me/channels'))
        return Promise.resolve(
          Response.json({
            id: '333333333333333333',
            type: 1,
            recipients: [{ id: '111111111111111111' }],
          }),
        );
      sends++;
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        nonce: string;
      };
      return Promise.resolve(
        Response.json({
          id: '444444444444444444',
          channel_id: '333333333333333333',
          nonce: body.nonce,
        }),
      );
    },
  });
  try {
    assert.equal((await queueTaskReminders(db, sourceId, () => at)).queued, 1);
    assert.equal((await queueTaskReminders(db, sourceId, () => at)).queued, 0);
    const operation = db.raw.prepare('SELECT id FROM task_checkin_operations').get();
    assert.ok(operation);
    db.raw
      .prepare(
        "INSERT INTO task_checkin_notifications(kind,operation_id,source_id,person_id,reserved_at) VALUES('digest','other',?,'member',?)",
      )
      .run(sourceId, at.toISOString());
    await processTaskDelivery(db, { notion, discord }, String(operation.id), () => at);
    assert.equal(sends, 0, 'a recent summary prevents a reminder burst');
    assert.equal(db.raw.prepare('SELECT attempts FROM task_checkin_operations').get()?.attempts, 0);
    db.raw.prepare('DELETE FROM task_checkin_notifications').run();
    const resumed = new Date(at.getTime() + 61_000);
    await processTaskDelivery(db, { notion, discord }, String(operation.id), () => resumed);
    await processTaskDelivery(db, { notion, discord }, String(operation.id), () => resumed);
    assert.equal(sends, 1);
    assert.equal(
      db.raw.prepare('SELECT state FROM task_checkin_operations').get()?.state,
      'confirmed',
    );
    assert.equal(
      db.raw.prepare('SELECT message_id FROM task_checkin_cards').get()?.message_id,
      '444444444444444444',
    );
  } finally {
    db.raw.close();
  }
});
void test('revocation during DM creation prevents sending task content', async () => {
  const { queueTaskReminders, processTaskDelivery } = await runtime();
  const db = await fixture();
  db.raw.prepare('DELETE FROM task_checkin_operations').run();
  let sends = 0;
  const discord = new DiscordTaskClient({
    guildId: taskPolicy.guildId,
    botToken: 'token',
    fetch: (url) => {
      if (typeof url === 'string' && url.includes('/guilds/'))
        return Promise.resolve(
          Response.json({ user: { id: '111111111111111111', username: 'member' }, roles: [] }),
        );
      if (typeof url === 'string' && url.endsWith('/users/@me/channels')) {
        db.raw.prepare("UPDATE task_checkin_consents SET state='paused',revision=revision+1").run();
        return Promise.resolve(
          Response.json({
            id: '333333333333333333',
            type: 1,
            recipients: [{ id: '111111111111111111' }],
          }),
        );
      }
      sends++;
      return Promise.resolve(Response.json({}));
    },
  });
  try {
    await queueTaskReminders(db, sourceId, () => at);
    const operation = db.raw.prepare('SELECT id FROM task_checkin_operations').get();
    assert.ok(operation);
    await processTaskDelivery(
      db,
      {
        notion: new NotionTaskClient('token', () => Promise.resolve(Response.json(page()))),
        discord,
      },
      String(operation.id),
      () => at,
    );
    assert.equal(sends, 0);
  } finally {
    db.raw.close();
  }
});
void test('quiet-hour deferral does not consume retry attempts or eventually fail an otherwise valid reminder', async () => {
  const { queueTaskReminders, processTaskDelivery } = await runtime();
  const db = await fixture();
  db.raw.prepare('DELETE FROM task_checkin_operations').run();
  let requests = 0;
  const discord = new DiscordTaskClient({
    guildId: taskPolicy.guildId,
    botToken: 'token',
    fetch: () => {
      requests++;
      return Promise.reject(new Error('must not request'));
    },
  });
  try {
    await queueTaskReminders(db, sourceId, () => at);
    const operation = db.raw.prepare('SELECT id FROM task_checkin_operations').get();
    assert.ok(operation);
    for (let minute = 0; minute < 10; minute++)
      await processTaskDelivery(
        db,
        { notion: new NotionTaskClient('token'), discord },
        String(operation.id),
        () => new Date(at.getTime() + 11 * 3_600_000 + minute * 60_000),
      );
    assert.equal(requests, 0);
    assert.equal(db.raw.prepare('SELECT attempts FROM task_checkin_operations').get()?.attempts, 0);
    assert.equal(
      db.raw.prepare('SELECT state FROM task_checkin_operations').get()?.state,
      'queued',
    );
  } finally {
    db.raw.close();
  }
});
void test('a malformed message-create response is held rather than risking a duplicate send', async () => {
  const { queueTaskReminders, processTaskDelivery } = await runtime();
  const db = await fixture();
  db.raw.prepare('DELETE FROM task_checkin_operations').run();
  let sends = 0;
  const discord = new DiscordTaskClient({
    guildId: taskPolicy.guildId,
    botToken: 'token',
    fetch: (url) => {
      if (typeof url === 'string' && url.includes('/guilds/'))
        return Promise.resolve(
          Response.json({ user: { id: '111111111111111111', username: 'member' }, roles: [] }),
        );
      if (typeof url === 'string' && url.endsWith('/users/@me/channels'))
        return Promise.resolve(
          Response.json({
            id: '333333333333333333',
            type: 1,
            recipients: [{ id: '111111111111111111' }],
          }),
        );
      sends++;
      return Promise.resolve(Response.json({ id: '444444444444444444' }));
    },
  });
  try {
    await queueTaskReminders(db, sourceId, () => at);
    const operation = db.raw.prepare('SELECT id FROM task_checkin_operations').get();
    assert.ok(operation);
    const notion = new NotionTaskClient('token', () => Promise.resolve(Response.json(page())));
    await processTaskDelivery(db, { notion, discord }, String(operation.id), () => at);
    assert.equal(db.raw.prepare('SELECT state FROM task_checkin_operations').get()?.state, 'held');
    await processTaskDelivery(db, { notion, discord }, String(operation.id), () => at);
    assert.equal(sends, 1);
  } finally {
    db.raw.close();
  }
});
