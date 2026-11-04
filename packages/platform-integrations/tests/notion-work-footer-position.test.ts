import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readWorkConversation,
  saveProjectHome,
  saveWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { NotionTaskClient } from '../src/notion-task-client';
import { ensureNotionWorkLink } from '../src/notion-work-links';
import {
  projectId,
  projectSourceId,
  sourceId,
  taskId,
  workFixture,
  workNow,
  workScope,
} from './support/discord-work';

function parseBody(value: BodyInit | null | undefined): Record<string, unknown> {
  assert.ok(typeof value === 'string');
  return JSON.parse(value) as Record<string, unknown>;
}
function isArchiveRequest(method: string | undefined, body: Record<string, unknown>): boolean {
  return method === 'DELETE' || body.archived === true || body.in_trash === true;
}

async function footerFixture() {
  const { db } = workFixture();
  const blocks: Record<string, unknown>[] = [];
  let nextId = 1;
  let loseAppendResponse = false;
  let loseArchiveResponse = false;
  let afterNextBlockRead: (() => void) | undefined;
  const fetcher: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.pathname.endsWith('/users/me'))
      return Promise.resolve(Response.json({ id: 'bot', type: 'bot' }));
    if (url.pathname.endsWith('/children')) {
      if (init?.method === 'PATCH') {
        const body = parseBody(init.body) as { children: Record<string, unknown>[] };
        const results = body.children.map((block) => ({
          ...block,
          id: String(nextId++).padStart(32, '0'),
          created_by: { id: 'bot' },
        }));
        blocks.push(...results);
        if (loseAppendResponse) {
          loseAppendResponse = false;
          return Promise.reject(new Error('connection lost after append'));
        }
        return Promise.resolve(Response.json({ results, has_more: false, next_cursor: null }));
      }
      const response = Response.json({ results: blocks, has_more: false, next_cursor: null });
      const callback = afterNextBlockRead;
      afterNextBlockRead = undefined;
      callback?.();
      return Promise.resolve(response);
    }
    const blockId = url.pathname.split('/').at(-1);
    const index = blocks.findIndex((block) => block.id === blockId);
    if (index < 0) return Promise.resolve(new Response(null, { status: 404 }));
    const body = init?.body ? parseBody(init.body) : {};
    if (isArchiveRequest(init?.method, body)) {
      const [removed] = blocks.splice(index, 1);
      if (loseArchiveResponse) {
        loseArchiveResponse = false;
        return Promise.reject(new Error('connection lost after archive'));
      }
      return Promise.resolve(Response.json({ ...removed, in_trash: true }));
    }
    blocks[index] = { ...blocks[index], ...body };
    return Promise.resolve(Response.json(blocks[index]));
  };
  const home = {
    id: 'home',
    scope: workScope,
    projectSourceId,
    projectId,
    destination: { kind: 'forum' as const, channelId: '333333333333333333', parentId: null },
    taskParent: null,
    audienceFingerprint: 'audience',
    approvedBy: 'guest',
    state: 'active' as const,
    generation: 1,
  };
  const conversation = {
    id: 'conversation',
    scope: workScope,
    subject: { kind: 'task' as const, sourceId, pageId: taskId },
    homeId: 'home',
    placementProjectId: projectId,
    threadId: '555555555555555555',
    starterMessageId: '555555555555555555',
    mode: 'automatic' as const,
    state: 'active' as const,
    generation: 1,
    activationId: '555555555555555555',
    cursorId: '555555555555555555',
    windowUpperId: null,
    windowBeforeId: null,
    footerBlockIds: [],
  };
  await saveProjectHome(db, home, 0, workNow);
  await saveWorkConversation(db, conversation, 0, workNow);
  return {
    db,
    blocks,
    conversation,
    client: () => new NotionTaskClient('fixture-only', fetcher),
    loseNextAppendResponse: () => {
      loseAppendResponse = true;
    },
    loseNextArchiveResponse: () => {
      loseArchiveResponse = true;
    },
    afterNextBlockRead: (callback: () => void) => {
      afterNextBlockRead = callback;
    },
    addOrganizerBlock: () => {
      const organizerBlock = {
        id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        type: 'paragraph',
        created_by: { id: 'organizer' },
        paragraph: { rich_text: [{ type: 'text', text: { content: 'New planning details' } }] },
      };
      blocks.push(organizerBlock);
      return organizerBlock;
    },
  };
}

void test('the managed Discord footer returns to the end after an organizer adds content', async () => {
  const fixture = await footerFixture();
  const { db, blocks, conversation } = fixture;
  try {
    const client = fixture.client();
    await ensureNotionWorkLink(db, client, conversation, workNow);
    const organizerBlock = fixture.addOrganizerBlock();

    await ensureNotionWorkLink(db, client, conversation, workNow);

    assert.deepEqual(
      blocks.map((block) => block.type),
      ['paragraph', 'divider', 'paragraph'],
    );
    assert.deepEqual(blocks[0], organizerBlock);
    assert.match(JSON.stringify(blocks[2]), /discord\.com\/channels\/.*555555555555555555/);
  } finally {
    db.raw.close();
  }
});

void test('footer reconciliation does not overwrite a concurrently advanced message cursor', async () => {
  const fixture = await footerFixture();
  const { db, conversation } = fixture;
  try {
    const client = fixture.client();
    await ensureNotionWorkLink(db, client, conversation, workNow);
    fixture.afterNextBlockRead(() => {
      db.raw
        .prepare(
          "UPDATE discord_work_conversations SET data_json=json_set(data_json,'$.cursorId',?) WHERE id=?",
        )
        .run('777777777777777777', conversation.id);
    });
    await ensureNotionWorkLink(db, client, conversation, workNow);
    assert.equal(
      (await readWorkConversation(db, workScope, conversation.id))?.cursorId,
      '777777777777777777',
    );
  } finally {
    db.raw.close();
  }
});

void test('repair preserves a footer paragraph edited by an organizer', async () => {
  const fixture = await footerFixture();
  const { db, blocks, conversation } = fixture;
  try {
    const client = fixture.client();
    await ensureNotionWorkLink(db, client, conversation, workNow);
    const footer = blocks[1];
    assert.ok(footer);
    const paragraph = footer.paragraph as { rich_text: unknown[] };
    paragraph.rich_text.push({ type: 'text', text: { content: ' Organizer note' } });
    fixture.addOrganizerBlock();
    const before = structuredClone(blocks);
    assert.deepEqual(await ensureNotionWorkLink(db, client, conversation, workNow), {
      kind: 'paused',
      reason: 'footer_modified',
    });
    assert.deepEqual(blocks, before);
  } finally {
    db.raw.close();
  }
});

for (const formatting of ['bold', 'text color', 'paragraph color'] as const) {
  void test(`repair preserves an organizer's ${formatting} on the footer`, async () => {
    const fixture = await footerFixture();
    const { db, blocks, conversation } = fixture;
    try {
      const client = fixture.client();
      await ensureNotionWorkLink(db, client, conversation, workNow);
      const footer = blocks[1];
      assert.ok(footer);
      const paragraph = footer.paragraph as {
        color?: string;
        rich_text: Record<string, unknown>[];
      };
      if (formatting === 'paragraph color') paragraph.color = 'red';
      else {
        const item = paragraph.rich_text[0];
        assert.ok(item);
        item.annotations = formatting === 'bold' ? { bold: true } : { color: 'red' };
      }
      fixture.addOrganizerBlock();
      const before = structuredClone(blocks);
      assert.deepEqual(await ensureNotionWorkLink(db, client, conversation, workNow), {
        kind: 'paused',
        reason: 'footer_modified',
      });
      assert.deepEqual(blocks, before);
    } finally {
      db.raw.close();
    }
  });
}

void test('repair pauses if an organizer removes the link from the recorded footer', async () => {
  const fixture = await footerFixture();
  const { db, blocks, conversation } = fixture;
  try {
    const client = fixture.client();
    await ensureNotionWorkLink(db, client, conversation, workNow);
    const footer = blocks[1];
    assert.ok(footer);
    footer.paragraph = { rich_text: [{ type: 'text', text: { content: 'Organizer note' } }] };
    const before = structuredClone(blocks);
    assert.deepEqual(await ensureNotionWorkLink(db, client, conversation, workNow), {
      kind: 'paused',
      reason: 'footer_modified',
    });
    assert.deepEqual(blocks, before);
  } finally {
    db.raw.close();
  }
});

void test('repair pauses if the recorded footer has been removed', async () => {
  const fixture = await footerFixture();
  const { db, blocks, conversation } = fixture;
  try {
    const client = fixture.client();
    await ensureNotionWorkLink(db, client, conversation, workNow);
    blocks.pop();
    const before = structuredClone(blocks);
    assert.deepEqual(await ensureNotionWorkLink(db, client, conversation, workNow), {
      kind: 'paused',
      reason: 'footer_missing',
    });
    assert.deepEqual(blocks, before);
  } finally {
    db.raw.close();
  }
});

void test('relinking does not overwrite organizer text added to the previous footer', async () => {
  const fixture = await footerFixture();
  const { db, blocks, conversation } = fixture;
  try {
    const client = fixture.client();
    await ensureNotionWorkLink(db, client, conversation, workNow);
    const footer = blocks[1];
    assert.ok(footer);
    const paragraph = footer.paragraph as { rich_text: { text: { link: { url: string } } }[] };
    const link = paragraph.rich_text[0];
    assert.ok(link);
    link.text.link.url = link.text.link.url.replace('lvbt_work=conversation', 'lvbt_work=previous');
    paragraph.rich_text.push({ text: { link: { url: 'https://example.com/organizer-note' } } });
    const before = structuredClone(blocks);
    assert.deepEqual(await ensureNotionWorkLink(db, client, conversation, workNow), {
      kind: 'paused',
      reason: 'footer_modified',
    });
    assert.deepEqual(blocks, before);
  } finally {
    db.raw.close();
  }
});

void test('a recorded previous footer can be relinked without changing other blocks', async () => {
  const fixture = await footerFixture();
  const { db, blocks, conversation } = fixture;
  try {
    const client = fixture.client();
    await ensureNotionWorkLink(db, client, conversation, workNow);
    const footer = blocks[1];
    assert.ok(footer);
    const paragraph = footer.paragraph as { rich_text: { text: { link: { url: string } } }[] };
    const link = paragraph.rich_text[0];
    assert.ok(link);
    link.text.link.url = link.text.link.url.replace('lvbt_work=conversation', 'lvbt_work=previous');
    assert.equal((await ensureNotionWorkLink(db, client, conversation, workNow)).kind, 'progress');
    assert.equal(blocks.length, 2);
    assert.match(JSON.stringify(blocks[1]), /lvbt_work=conversation/);
  } finally {
    db.raw.close();
  }
});

void test('a previous footer without a recorded ownership link is not redirected', async () => {
  const fixture = await footerFixture();
  const { db, blocks, conversation } = fixture;
  try {
    const client = fixture.client();
    await ensureNotionWorkLink(db, client, conversation, workNow);
    const footer = blocks[1];
    assert.ok(footer);
    const paragraph = footer.paragraph as { rich_text: { text: { link: { url: string } } }[] };
    const link = paragraph.rich_text[0];
    assert.ok(link);
    link.text.link.url = link.text.link.url.replace('lvbt_work=conversation', 'lvbt_work=other');
    db.raw
      .prepare(
        "UPDATE discord_work_conversations SET data_json=json_set(data_json,'$.footerBlockIds',json('[]')) WHERE id=?",
      )
      .run(conversation.id);
    const before = structuredClone(blocks);
    assert.deepEqual(await ensureNotionWorkLink(db, client, conversation, workNow), {
      kind: 'paused',
      reason: 'footer_ownership_unverified',
    });
    assert.deepEqual(blocks, before);
  } finally {
    db.raw.close();
  }
});

for (const failure of ['append', 'archive'] as const) {
  void test(`repair resumes after losing an ${failure} response without duplicate footers`, async () => {
    const fixture = await footerFixture();
    const { db, blocks, conversation } = fixture;
    try {
      const client = fixture.client();
      await ensureNotionWorkLink(db, client, conversation, workNow);
      const organizerBlock = fixture.addOrganizerBlock();
      if (failure === 'append') fixture.loseNextAppendResponse();
      else fixture.loseNextArchiveResponse();
      await assert.rejects(ensureNotionWorkLink(db, client, conversation, workNow));
      await ensureNotionWorkLink(db, fixture.client(), conversation, workNow);
      assert.deepEqual(
        blocks.map((block) => block.type),
        ['paragraph', 'divider', 'paragraph'],
      );
      assert.deepEqual(blocks[0], organizerBlock);
    } finally {
      db.raw.close();
    }
  });
}
