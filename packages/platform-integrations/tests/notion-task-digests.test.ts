import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, page, sourceId } from './support/task-action-fixture';
import { NotionTaskClient } from '../src/notion-task-client';
import { DiscordTaskClient } from '../src/notion-task-discord';
import { taskPolicy } from './support/task-checkins';
import { parseNotionTaskPage } from '../src/notion-task-reader';
import { upsertNotionTaskSnapshot } from '@lasvegasfortransit/platform-storage/notion-task-checkins';
const at = new Date('2026-10-23T18:00:00Z'),
  secondId = '10000000-0000-4000-8000-000000000004';
async function digests() {
  const module = await import('../src/notion-task-digests').catch(() => null);
  assert.ok(module, 'private aggregated daily digests must exist');
  return module;
}
async function prepare() {
  const db = await fixture();
  const second = page();
  second.id = secondId;
  second.url = `https://www.notion.so/${secondId}`;
  second.properties['Task name'].title = [{ plain_text: 'Write summary' }];
  const parsed = parseNotionTaskPage(second, { ...taskPolicy, rangeBoundary: 'reject', sourceId });
  assert.ok(parsed);
  await upsertNotionTaskSnapshot(
    db,
    {
      sourceId,
      taskId: secondId,
      revision: 'second',
      active: true,
      sourceEditedAt: at.toISOString(),
      snapshot: parsed.snapshot,
    },
    at,
  );
  return { db, second };
}
void test('all current tasks become one private daily summary and repeated ticks do not repost it', async () => {
  const { queueDailyTaskDigests, processDailyTaskDigest } = await digests(),
    { db, second } = await prepare();
  let sends = 0;
  let sent = '';
  const notion = new NotionTaskClient('token', (url) =>
    Promise.resolve(
      Response.json(typeof url === 'string' && url.endsWith(secondId) ? second : page()),
    ),
  );
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
      sent = typeof init?.body === 'string' ? init.body : '';
      const body = JSON.parse(sent) as { nonce: string };
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
    assert.equal(await queueDailyTaskDigests(db, sourceId, () => at), 1);
    db.raw
      .prepare(
        "INSERT INTO task_checkin_notifications(kind,operation_id,source_id,person_id,reserved_at) VALUES('delivery','other',?,'member',?)",
      )
      .run(sourceId, at.toISOString());
    await processDailyTaskDigest(db, { notion, discord }, sourceId, () => at);
    assert.equal(sends, 0, 'a recent reminder also defers the summary');
    assert.equal(db.raw.prepare('SELECT attempts FROM task_checkin_digests').get()?.attempts, 0);
    db.raw.prepare('DELETE FROM task_checkin_notifications').run();
    await processDailyTaskDigest(
      db,
      { notion, discord },
      sourceId,
      () => new Date(at.getTime() + 61_000),
    );
    assert.equal(await queueDailyTaskDigests(db, sourceId, () => at), 0);
    await processDailyTaskDigest(db, { notion, discord }, sourceId, () => at);
    assert.equal(sends, 1);
    assert.match(sent, /Finish agenda/);
    assert.match(sent, /Write summary/);
    assert.equal(
      db.raw.prepare('SELECT state FROM task_checkin_digests').get()?.state,
      'confirmed',
    );
    assert.match(sent, /"allowed_mentions":\{"parse":\[\]\}/);
  } finally {
    db.raw.close();
  }
});
void test('reassigned tasks are not exposed in the digest', async () => {
  const { queueDailyTaskDigests, processDailyTaskDigest } = await digests(),
    { db, second } = await prepare();
  let sent = '';
  second.properties.Assignee.people = [{ id: 'someone-else' }];
  const notion = new NotionTaskClient('token', (url) =>
    Promise.resolve(
      Response.json(typeof url === 'string' && url.endsWith(secondId) ? second : page()),
    ),
  );
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
      sent = typeof init?.body === 'string' ? init.body : '';
      const body = JSON.parse(sent) as { nonce: string };
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
    await queueDailyTaskDigests(db, sourceId, () => at);
    await processDailyTaskDigest(db, { notion, discord }, sourceId, () => at);
    assert.match(sent, /Finish agenda/);
    assert.equal(sent.includes('Write summary'), false);
    assert.equal(sent.includes(secondId), false);
    assert.equal(
      db.raw.prepare('SELECT state FROM task_checkin_digests').get()?.state,
      'confirmed',
    );
  } finally {
    db.raw.close();
  }
});
void test('revoking consent while a digest DM is opening suppresses its entire payload', async () => {
  const { queueDailyTaskDigests, processDailyTaskDigest } = await digests(),
    { db } = await prepare();
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
    await queueDailyTaskDigests(db, sourceId, () => at);
    await processDailyTaskDigest(
      db,
      {
        notion: new NotionTaskClient('token', () => Promise.resolve(Response.json(page()))),
        discord,
      },
      sourceId,
      () => at,
    );
    assert.equal(sends, 0);
  } finally {
    db.raw.close();
  }
});
void test('an uncertain digest send is held and does not repeat while Discord nonce deduplication could expire', async () => {
  const { queueDailyTaskDigests, processDailyTaskDigest } = await digests(),
    { db } = await prepare();
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
      return Promise.reject(new Error('timeout'));
    },
  });
  try {
    await queueDailyTaskDigests(db, sourceId, () => at);
    const providers = {
      notion: new NotionTaskClient('token', () => Promise.resolve(Response.json(page()))),
      discord,
    };
    await processDailyTaskDigest(db, providers, sourceId, () => at);
    await processDailyTaskDigest(db, providers, sourceId, () => new Date(at.getTime() + 300_000));
    assert.equal(sends, 1);
    assert.equal(db.raw.prepare('SELECT state FROM task_checkin_digests').get()?.state, 'held');
  } finally {
    db.raw.close();
  }
});
void test('digest rendering stays bounded, marks omitted tasks, and escapes mentions and links', async () => {
  const { renderTaskDigest } = await import('../src/notion-task-digest-card');
  const raw = page();
  const parsed = parseNotionTaskPage(raw, { ...taskPolicy, rangeBoundary: 'reject', sourceId });
  assert.ok(parsed);
  const rendered = JSON.stringify(
    renderTaskDigest({
      day: '2026-10-23',
      tasks: Array.from({ length: 10 }, () => ({
        ...parsed.snapshot,
        title: '@everyone [open](https://untrusted.invalid)',
      })),
      more: true,
    }),
  );
  assert.equal((rendered.match(/"type":9/g) ?? []).length, 5);
  assert.equal(rendered.includes('@everyone'), false);
  assert.match(rendered, /More assigned tasks/);
  assert.throws(() =>
    renderTaskDigest({
      day: '2026-10-23',
      tasks: [{ ...parsed.snapshot, url: 'https://untrusted.invalid' }],
      more: false,
    }),
  );
});
void test('a digest batch respects the query allowance including shared Discord rate-limit reads', async () => {
  const { runDailyTaskDigestBatch } = await digests();
  const db = await fixture();
  const { setTaskCheckinConsent, putNotionTaskMapping } =
    await import('@lasvegasfortransit/platform-storage/notion-task-checkins');
  const { queryBudget } = await import('@lasvegasfortransit/platform-storage/query-budget');
  const people = ['member', 'guest2', 'guest3', 'guest4', 'guest5'];
  const raw = page();
  raw.properties.Assignee.people = people.map((id) => ({ id: `notion-${id}` }));
  db.raw
    .prepare('UPDATE task_checkin_sources SET policy_json=?')
    .run(JSON.stringify({ ...taskPolicy, cohortPersonIds: people }));
  for (let index = 1; index < people.length; index++) {
    const personId = people[index];
    assert.ok(personId);
    const userId = `11111111111111111${index + 1}`;
    db.raw
      .prepare('INSERT INTO people(id,created_at,updated_at) VALUES(?,?,?)')
      .run(personId, at.toISOString(), at.toISOString());
    db.raw
      .prepare(
        "INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at) VALUES(?,?,'discord',?,?,'staff_confirmed',?,?)",
      )
      .run(
        `discord-${personId}`,
        personId,
        userId,
        at.toISOString(),
        at.toISOString(),
        at.toISOString(),
      );
    await putNotionTaskMapping(
      db,
      {
        workspaceId: 'workspace',
        notionUserId: `notion-${personId}`,
        personId,
        confirmedBy: 'member',
      },
      at,
    );
    await setTaskCheckinConsent(
      db,
      {
        sourceId,
        personId,
        discordUserId: userId,
        interactionId: userId,
        state: 'active',
        policyRevision: 1,
      },
      at,
    );
  }
  const parsed = parseNotionTaskPage(raw, { ...taskPolicy, sourceId, rangeBoundary: 'reject' });
  assert.ok(parsed);
  db.raw
    .prepare('UPDATE task_checkin_tasks SET snapshot_json=?')
    .run(JSON.stringify(parsed.snapshot));
  const budget = queryBudget(db, 50);
  const { discordRateLimit } = await import('../src/discord-rate-limit');
  let sends = 0;
  const discord = new DiscordTaskClient({
    guildId: taskPolicy.guildId,
    rateLimit: discordRateLimit(budget.db, '222222222222222222', () => at),
    botToken: 'test',
    fetch: (url, init) => {
      assert.ok(typeof url === 'string');
      if (url.includes('/guilds/'))
        return Promise.resolve(
          Response.json({ user: { id: url.split('/').at(-1), username: 'volunteer' }, roles: [] }),
        );
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<
        string,
        unknown
      >;
      if (url.endsWith('/users/@me/channels')) {
        const id = String(body.recipient_id);
        return Promise.resolve(
          Response.json({ id: `3${id.slice(1)}`, type: 1, recipients: [{ id }] }),
        );
      }
      sends++;
      return Promise.resolve(
        Response.json({
          id: `44444444444444444${sends}`,
          channel_id: url.split('/').at(-2),
          nonce: body.nonce,
        }),
      );
    },
  });
  try {
    const { taskProviderCoolingDown } =
      await import('@lasvegasfortransit/platform-storage/notion-task-provider-backoff');
    assert.equal(await taskProviderCoolingDown(budget.db, sourceId, at), false);
    const result = await runDailyTaskDigestBatch(
      budget.db,
      { notion: new NotionTaskClient('test', () => Promise.resolve(Response.json(raw))), discord },
      sourceId,
      () => at,
    );
    assert.equal(result.processed, 4);
    assert.equal(sends, 4);
    assert.ok(budget.queries <= 50);
    assert.equal(
      db.raw.prepare("SELECT count(*) AS n FROM task_checkin_digests WHERE state='confirmed'").get()
        ?.n,
      4,
    );
  } finally {
    db.raw.close();
  }
});
