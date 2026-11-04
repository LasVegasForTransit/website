import assert from 'node:assert/strict';
import test from 'node:test';
import { NotionTaskClient } from '../src/notion-task-client';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { discoverWorkSources, inspectWorkSourceFields } from '../src/discord-work-source-discovery';
import { discordUserId, sourceId, workFixture, workNow, workScope } from './support/discord-work';

void test('source discovery is admin-only and returns named, paginated Notion sources', async () => {
  const { db } = workFixture();
  const requests: Record<string, unknown>[] = [];
  const notion = new NotionTaskClient('fixture-only', (_input, init) => {
    const body = init?.body;
    assert.ok(typeof body === 'string');
    requests.push(JSON.parse(body) as Record<string, unknown>);
    return Promise.resolve(
      Response.json({
        results: [{ object: 'data_source', id: sourceId, title: [{ plain_text: 'Events' }] }],
        has_more: true,
        next_cursor: 'next',
      }),
    );
  });
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  Object.assign(discord, { membership: () => Promise.resolve(true) });
  try {
    assert.deepEqual(
      await discoverWorkSources(
        db,
        { notion, discord },
        {
          scope: workScope,
          discordUserId: discordUserId,
          input: {
            query: 'Events',
            cursor: null,
          },
        },
      ),
      { kind: 'unavailable' },
    );
    assert.equal(requests.length, 0);
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
      )
      .run(workNow.toISOString());
    assert.deepEqual(
      await discoverWorkSources(
        db,
        { notion, discord },
        {
          scope: workScope,
          discordUserId: discordUserId,
          input: {
            query: 'Events',
            cursor: 'prior',
          },
        },
      ),
      { kind: 'ready', sources: [{ id: sourceId, title: 'Events' }], nextCursor: 'next' },
    );
    assert.deepEqual(requests[0], {
      query: 'Events',
      filter: { property: 'object', value: 'data_source' },
      page_size: 25,
      start_cursor: 'prior',
    });
  } finally {
    db.raw.close();
  }
});

void test('source field discovery returns status and select choices only to administrators', async () => {
  const { db, notion } = workFixture();
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  let reads = 0;
  Object.assign(notion, {
    readDataSource: () => {
      reads++;
      return Promise.resolve({
        object: 'data_source',
        id: sourceId,
        properties: {
          Status: { type: 'status', status: { options: [{ name: 'Planning' }, { name: 'Done' }] } },
          Category: { type: 'select', select: { options: [{ name: 'Workshop' }] } },
          Owner: { type: 'people', people: {} },
        },
      });
    },
  });
  Object.assign(discord, { membership: () => Promise.resolve(true) });
  try {
    assert.deepEqual(
      await inspectWorkSourceFields(
        db,
        { notion, discord },
        { scope: workScope, discordUserId: discordUserId, sourceId: sourceId },
      ),
      { kind: 'unavailable' },
    );
    assert.equal(reads, 0);
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
      )
      .run(workNow.toISOString());
    assert.deepEqual(
      await inspectWorkSourceFields(
        db,
        { notion, discord },
        { scope: workScope, discordUserId: discordUserId, sourceId: sourceId },
      ),
      {
        kind: 'ready',
        fields: [
          { name: 'Status', type: 'status', values: ['Planning', 'Done'] },
          { name: 'Category', type: 'select', values: ['Workshop'] },
        ],
      },
    );
  } finally {
    db.raw.close();
  }
});
