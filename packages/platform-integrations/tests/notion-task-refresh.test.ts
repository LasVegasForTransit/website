import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, page, sourceId, pageId, now } from './support/task-action-fixture';
import { taskPolicy } from './support/task-checkins';
import { NotionTaskClient } from '../src/notion-task-client';
import { DiscordTaskClient } from '../src/notion-task-discord';
import { processNotionTaskAction } from '../src/notion-task-actions';
import {
  ensureTaskCard,
  attachTaskCardMessage,
} from '@lasvegasfortransit/platform-storage/notion-task-cards';
import { recordTaskInteraction } from '@lasvegasfortransit/platform-storage/notion-task-checkins';
const channelId = '333333333333333333',
  messageId = '444444444444444444';
async function refresh() {
  const module = await import('../src/notion-task-refresh').catch(() => null);
  assert.ok(module, 'existing Discord cards must refresh durably');
  return module;
}
async function prepare(kind: 'progress' | 'complete' | 'snooze' = 'progress') {
  const db = await fixture(kind);
  const card = await ensureTaskCard(db, { sourceId, taskId: pageId, personId: 'member' }, now);
  assert.ok(card);
  await attachTaskCardMessage(db, { token: card.token, channelId, messageId }, now);
  db.raw.prepare('DELETE FROM task_checkin_operations').run();
  await recordTaskInteraction(
    db,
    {
      id: 'response',
      sourceId,
      taskId: pageId,
      personId: 'member',
      taskRevision: 'v1',
      policyRevision: 1,
      consentRevision: 1,
      kind,
      payload: { text: 'The agenda is ready' },
    },
    now,
  );
  return db;
}
function discordClient(onEdit: (body: string) => void, onOpen: () => void = () => {}) {
  return new DiscordTaskClient({
    guildId: taskPolicy.guildId,
    botToken: 'test',
    fetch: (url, init) => {
      assert.ok(typeof url === 'string');
      if (url.includes('/guilds/'))
        return Promise.resolve(
          Response.json({ user: { id: '111111111111111111', username: 'member' }, roles: [] }),
        );
      if (url.endsWith('/users/@me/channels')) {
        onOpen();
        return Promise.resolve(
          Response.json({ id: channelId, type: 1, recipients: [{ id: '111111111111111111' }] }),
        );
      }
      assert.equal(init?.method, 'PATCH', 'refresh must edit an existing message');
      assert.equal(url, `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`);
      onEdit(typeof init.body === 'string' ? init.body : '');
      return Promise.resolve(Response.json({ id: messageId, channel_id: channelId }));
    },
  });
}
void test('an existing card stays pending until Notion confirms the response, then refreshes without another write or message', async () => {
  const { processTaskCardRefresh } = await refresh(),
    db = await prepare();
  let notes = 0;
  const edits: string[] = [];
  const notion = new NotionTaskClient('test', (_url, init) => {
    if (init?.method === 'POST') {
      notes++;
      return Promise.resolve(Response.json({ object: 'comment', id: pageId }));
    }
    return Promise.resolve(Response.json(page()));
  });
  const discord = discordClient((body) => edits.push(body));
  try {
    await processTaskCardRefresh(db, { notion, discord }, sourceId, () => now);
    assert.match(edits[0] ?? '', /waiting to be saved/);
    assert.equal(notes, 0);
    await processNotionTaskAction(db, notion, 'response', {
      membership: () => Promise.resolve(true),
      clock: () => now,
    });
    await processTaskCardRefresh(db, { notion, discord }, sourceId, () => now);
    assert.match(edits[1] ?? '', /was saved in Notion/);
    assert.equal(notes, 1);
    await processTaskCardRefresh(db, { notion, discord }, sourceId, () => now);
    assert.equal(edits.length, 2);
  } finally {
    db.raw.close();
  }
});
void test('confirmed completion shows Done in a read-only status dropdown', async () => {
  const { processTaskCardRefresh } = await refresh(),
    db = await prepare('complete');
  const current = page();
  let writes = 0,
    edited = '';
  const notion = new NotionTaskClient('test', (_url, init) => {
    if (init?.method === 'PATCH') {
      writes++;
      current.properties.Status.status.name = 'Done';
    }
    return Promise.resolve(Response.json(current));
  });
  try {
    await processNotionTaskAction(db, notion, 'response', {
      membership: () => Promise.resolve(true),
      clock: () => now,
    });
    await processTaskCardRefresh(
      db,
      {
        notion,
        discord: discordClient((body) => {
          edited = body;
        }),
      },
      sourceId,
      () => now,
    );
    assert.equal(writes, 1);
    assert.match(edited, /Done/);
    assert.match(edited, /was saved in Notion/);
    assert.match(edited, /"value":"Done","default":true/);
    assert.match(edited, /"disabled":true/);
    assert.doesNotMatch(edited, /Add update/);
  } finally {
    db.raw.close();
  }
});
void test('a local snooze is described as snoozed rather than saved to Notion', async () => {
  const { processTaskCardRefresh } = await refresh(),
    db = await prepare('snooze');
  let edited = '';
  const notion = new NotionTaskClient('test', (_url, init) => {
    assert.equal(init?.method, 'GET');
    return Promise.resolve(Response.json(page()));
  });
  try {
    await processNotionTaskAction(db, notion, 'response', {
      membership: () => Promise.resolve(true),
      clock: () => now,
    });
    await processTaskCardRefresh(
      db,
      {
        notion,
        discord: discordClient((body) => {
          edited = body;
        }),
      },
      sourceId,
      () => now,
    );
    assert.match(edited, /reminder is snoozed/);
    assert.equal(edited.includes('was saved in Notion'), false);
  } finally {
    db.raw.close();
  }
});
void test('reassigned tasks replace their old card with a private stale notice without revealing new content', async () => {
  const { processTaskCardRefresh } = await refresh(),
    db = await prepare();
  const current = page();
  current.properties.Assignee.people = [{ id: 'other-person' }];
  current.properties['Task name'].title = [{ plain_text: 'PRIVATE NEW SCOPE' }];
  let edited = '';
  try {
    await processTaskCardRefresh(
      db,
      {
        notion: new NotionTaskClient('test', () => Promise.resolve(Response.json(current))),
        discord: discordClient((body) => {
          edited = body;
        }),
      },
      sourceId,
      () => now,
    );
    assert.match(edited, /task has changed/);
    assert.equal(edited.includes('PRIVATE NEW SCOPE'), false);
    assert.equal(edited.includes('https://www.notion.so'), false);
  } finally {
    db.raw.close();
  }
});
void test('consent revocation during DM verification prevents editing the old card', async () => {
  const { processTaskCardRefresh } = await refresh(),
    db = await prepare();
  let edits = 0,
    opened = false;
  try {
    const discord = discordClient(
      () => {
        edits++;
      },
      () => {
        opened = true;
        db.raw.prepare("UPDATE task_checkin_consents SET state='paused',revision=revision+1").run();
      },
    );
    await processTaskCardRefresh(
      db,
      {
        notion: new NotionTaskClient('test', () => Promise.resolve(Response.json(page()))),
        discord,
      },
      sourceId,
      () => now,
    );
    assert.equal(opened, true);
    assert.equal(edits, 0);
  } finally {
    db.raw.close();
  }
});
void test('a newer response waits for an existing PATCH before rendering its confirmed state', async () => {
  const { processTaskCardRefresh } = await refresh(),
    db = await prepare();
  const edits: string[] = [];
  let releasePatch: () => void = () => {};
  let markStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const discord = new DiscordTaskClient({
    guildId: taskPolicy.guildId,
    botToken: 'test',
    fetch: (url, init) => {
      assert.ok(typeof url === 'string');
      if (url.includes('/guilds/'))
        return Promise.resolve(
          Response.json({ user: { id: '111111111111111111', username: 'member' }, roles: [] }),
        );
      if (url.endsWith('/users/@me/channels'))
        return Promise.resolve(
          Response.json({ id: channelId, type: 1, recipients: [{ id: '111111111111111111' }] }),
        );
      assert.equal(init?.method, 'PATCH');
      edits.push(typeof init.body === 'string' ? init.body : '');
      if (edits.length === 1)
        return new Promise<Response>((resolve) => {
          releasePatch = () => resolve(Response.json({ id: messageId, channel_id: channelId }));
          markStarted();
        });
      return Promise.resolve(Response.json({ id: messageId, channel_id: channelId }));
    },
  });
  try {
    const providers = {
      notion: new NotionTaskClient('test', () => Promise.resolve(Response.json(page()))),
      discord,
    };
    const first = processTaskCardRefresh(db, providers, sourceId, () => now);
    await started;
    db.raw
      .prepare("UPDATE task_checkin_operations SET state='confirmed' WHERE id='response'")
      .run();
    assert.equal((await processTaskCardRefresh(db, providers, sourceId, () => now)).kind, 'idle');
    releasePatch();
    await first;
    await processTaskCardRefresh(db, providers, sourceId, () => now);
    assert.equal(edits.length, 2);
    assert.match(edits[0] ?? '', /waiting to be saved/);
    assert.match(edits[1] ?? '', /was saved in Notion/);
    assert.equal(
      db.raw.prepare('SELECT state FROM task_checkin_card_refreshes').get()?.state,
      'confirmed',
    );
  } finally {
    releasePatch();
    db.raw.close();
  }
});

void test('a staff-closed uncertain response stays visibly unconfirmed in the private card', async () => {
  const { processTaskCardRefresh } = await refresh(),
    db = await prepare();
  try {
    db.raw
      .prepare("UPDATE task_checkin_operations SET state='superseded',reason='staff_closed'")
      .run();
    const edits: string[] = [];
    await processTaskCardRefresh(
      db,
      {
        notion: new NotionTaskClient('test', () => Promise.resolve(Response.json(page()))),
        discord: discordClient((body) => edits.push(body)),
      },
      sourceId,
      () => now,
    );
    assert.match(edits[0] ?? '', /has not been confirmed in Notion/);
    assert.equal((edits[0] ?? '').includes('was saved in Notion'), false);
  } finally {
    db.raw.close();
  }
});
