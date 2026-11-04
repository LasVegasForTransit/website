import assert from 'node:assert/strict';
import test from 'node:test';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { saveProjectHome } from '@lasvegasfortransit/platform-storage/discord-work-links';
import {
  workFixture,
  workScope,
  workNow,
  sourceId,
  projectId,
  discordUserId,
  projectSourceId,
} from './support/discord-work';

void test('show and unlink use a Notion URL to select a record in a crowded thread', async () => {
  const { saveWorkConversation } =
    await import('@lasvegasfortransit/platform-storage/discord-work-links');
  const { runWorkPreview } = await import('../src/discord-work-setup');
  const { db, notion } = workFixture();
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  Object.assign(discord, { membership: () => Promise.resolve(true) });
  const forumId = '333333333333333333',
    threadId = '555555555555555555',
    targetPage = '20000000-0000-4000-8000-000000000050';
  try {
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
      )
      .run(workNow.toISOString());
    await saveProjectHome(
      db,
      {
        id: 'home',
        scope: workScope,
        projectSourceId,
        projectId,
        destination: { kind: 'forum', channelId: forumId, parentId: null },
        taskParent: null,
        audienceFingerprint: 'audience',
        approvedBy: 'guest',
        state: 'active',
        generation: 1,
      },
      0,
      workNow,
    );
    for (let i = 0; i < 51; i++) {
      const pageId = `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      await saveWorkConversation(
        db,
        {
          id: `c-${String(i).padStart(3, '0')}`,
          scope: workScope,
          subject: { kind: 'task', sourceId, pageId },
          homeId: 'home',
          placementProjectId: projectId,
          threadId,
          starterMessageId: threadId,
          mode: 'selected',
          state: 'active',
          generation: 1,
          activationId: threadId,
          cursorId: threadId,
          windowUpperId: null,
          windowBeforeId: null,
          footerBlockIds: [],
          ...(i === 50 ? { reason: 'audience_or_permission_changed' } : {}),
        },
        0,
        workNow,
      );
    }
    const base = {
      applicationId: '444444444444444444',
      guildId: workScope.guildId,
      discordUserId,
      channelId: threadId,
      interactionId: '777777777777777777',
    };
    const context = {
      scope: workScope,
      taskSourceId: sourceId,
      enabled: true,
      clock: () => workNow,
    };
    const url = `https://www.notion.so/${targetPage}`;
    assert.match(
      JSON.stringify(
        await runWorkPreview(
          db,
          { notion, discord },
          { ...base, intent: { action: 'show', url } },
          context,
        ),
      ),
      /approved audience/i,
    );
    await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'unlink', url } },
      context,
    );
    assert.equal(
      db.raw.prepare("SELECT state FROM discord_work_conversations WHERE id='c-050'").get()?.state,
      'unlinked',
    );
    assert.equal(
      db.raw
        .prepare("SELECT count(*) AS n FROM discord_work_conversations WHERE state='active'")
        .get()?.n,
      50,
    );
  } finally {
    db.raw.close();
  }
});

void test('link reuses an existing project beyond the first 50 projects', async () => {
  const { runWorkPreview } = await import('../src/discord-work-setup');
  const { db, notion } = workFixture();
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  Object.assign(discord, { membership: () => Promise.resolve(true) });
  const forumId = '333333333333333333';
  try {
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
      )
      .run(workNow.toISOString());
    for (let i = 0; i < 51; i++) {
      const pageId =
        i === 50 ? projectId : `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      await saveProjectHome(
        db,
        {
          id: i === 50 ? 'z-target' : `a-${String(i).padStart(3, '0')}`,
          scope: workScope,
          projectSourceId,
          projectId: pageId,
          destination: { kind: 'forum', channelId: forumId, parentId: null },
          taskParent: null,
          audienceFingerprint: 'audience',
          approvedBy: 'guest',
          state: 'active',
          generation: 1,
        },
        0,
        workNow,
      );
    }
    const { findProjectHomesForPlacement } =
      await import('@lasvegasfortransit/platform-storage/discord-work-links');
    const matches = await findProjectHomesForPlacement(db, workScope, {
      sourceId: projectSourceId,
      projectIds: [projectId],
      channelId: forumId,
      parentId: null,
    });
    assert.deepEqual(
      matches.map((home) => home.id),
      ['z-target'],
    );
    assert.deepEqual(
      await findProjectHomesForPlacement(db, workScope, {
        sourceId: projectSourceId,
        projectIds: [projectId],
        channelId: '999999999999999999',
        parentId: null,
      }),
      [],
    );
    const input = {
      applicationId: '444444444444444444',
      guildId: workScope.guildId,
      discordUserId,
      channelId: forumId,
      interactionId: '777777777777777777',
      intent: { action: 'link', url: `https://www.notion.so/${projectId}` },
    };
    const result = await runWorkPreview(db, { notion, discord }, input, {
      scope: workScope,
      taskSourceId: sourceId,
      enabled: true,
      clock: () => workNow,
    });
    assert.match(
      JSON.stringify(result),
      new RegExp(`discord\\.com/channels/${workScope.guildId}/${forumId}`),
    );
    assert.equal(
      db.raw
        .prepare("SELECT count(*) AS n FROM discord_work_operations WHERE state='preview'")
        .get()?.n,
      0,
    );
  } finally {
    db.raw.close();
  }
});
