import assert from 'node:assert/strict';
import test from 'node:test';
import { readWorkConversation } from '@lasvegasfortransit/platform-storage/discord-work-links';
import { ensureNotionWorkLink } from '../src/notion-work-links';
import { workNow, workScope } from './support/discord-work';
import { footerFixture } from './support/notion-work-footer';

void test('footer repair preserves edits made while the replacement is being appended', async () => {
  const fixture = await footerFixture();
  try {
    const client = fixture.client();
    await ensureNotionWorkLink(fixture.db, client, fixture.conversation, workNow);
    const old = fixture.blocks[1];
    assert.ok(old);
    fixture.addOrganizerBlock();
    fixture.afterNextAppend(() => {
      Object.assign(old, { has_children: true });
    });
    const result = await ensureNotionWorkLink(fixture.db, client, fixture.conversation, workNow);
    assert.equal(result.reason, 'footer_modified');
    assert.equal(fixture.blocks.includes(old), true);
  } finally {
    fixture.db.raw.close();
  }
});

void test('footer repair preserves edits made during the final authorization check', async () => {
  const fixture = await footerFixture();
  try {
    const client = fixture.client();
    await ensureNotionWorkLink(fixture.db, client, fixture.conversation, workNow);
    const old = fixture.blocks[1];
    assert.ok(old);
    fixture.addOrganizerBlock();
    let checks = 0;
    const result = await ensureNotionWorkLink(fixture.db, client, fixture.conversation, {
      now: workNow,
      beforeWrite: () => {
        if (++checks === 2) Object.assign(old, { has_children: true });
        return Promise.resolve(true);
      },
    });
    assert.equal(result.reason, 'footer_modified');
    assert.equal(fixture.blocks.includes(old), true);
  } finally {
    fixture.db.raw.close();
  }
});

void test('footer repair preserves edits made while the old divider is archived', async () => {
  const fixture = await footerFixture();
  try {
    const client = fixture.client();
    await ensureNotionWorkLink(fixture.db, client, fixture.conversation, workNow);
    const old = fixture.blocks[1];
    assert.ok(old);
    fixture.addOrganizerBlock();
    fixture.afterNextArchive(() => Object.assign(old, { has_children: true }));
    const result = await ensureNotionWorkLink(fixture.db, client, fixture.conversation, workNow);
    assert.equal(result.reason, 'footer_modified');
    assert.equal(fixture.blocks.includes(old), true);
  } finally {
    fixture.db.raw.close();
  }
});

void test('footer repair pauses when authority changes after appending a replacement', async () => {
  const fixture = await footerFixture();
  try {
    const client = fixture.client();
    await ensureNotionWorkLink(fixture.db, client, fixture.conversation, workNow);
    fixture.addOrganizerBlock();
    let checks = 0;
    const result = await ensureNotionWorkLink(fixture.db, client, fixture.conversation, {
      now: workNow,
      beforeWrite: () => Promise.resolve(++checks === 1),
    });
    assert.equal(result.kind, 'paused');
    assert.equal(result.reason, 'link_changed');
    assert.equal(fixture.blocks.length, 5);
  } finally {
    fixture.db.raw.close();
  }
});

void test('repair of a five-page Notion page fits the jobs request budget', async () => {
  const fixture = await footerFixture();
  try {
    await ensureNotionWorkLink(fixture.db, fixture.client(), fixture.conversation, workNow);
    for (let i = 0; i < 400; i++) fixture.addOrganizerBlock();
    const client = fixture.client(20);
    const result = await ensureNotionWorkLink(fixture.db, client, fixture.conversation, {
      now: workNow,
      beforeWrite: async () => {
        await client.readPage(fixture.conversation.subject.pageId);
        return true;
      },
    });
    assert.equal(result.kind, 'progress');
  } finally {
    fixture.db.raw.close();
  }
});

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
