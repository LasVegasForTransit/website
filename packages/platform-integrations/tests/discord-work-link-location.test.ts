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

void test('show and unlink find the current conversation beyond the first 50 links', async () => {
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
    threadId = '555555555555555555';
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
      const last = i === 50;
      const id = last ? 'z-target' : `a-${String(i).padStart(3, '0')}`;
      const pageId = `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      const thread = last ? threadId : String(600000000000000000n + BigInt(i));
      await saveWorkConversation(
        db,
        {
          id,
          scope: workScope,
          subject: { kind: 'task', sourceId, pageId },
          homeId: 'home',
          placementProjectId: projectId,
          threadId: thread,
          starterMessageId: thread,
          mode: 'selected',
          state: 'active',
          generation: 1,
          activationId: thread,
          cursorId: thread,
          windowUpperId: null,
          windowBeforeId: null,
          footerBlockIds: [],
        },
        0,
        workNow,
      );
    }
    const input = {
      applicationId: '444444444444444444',
      guildId: workScope.guildId,
      discordUserId,
      channelId: threadId,
      interactionId: '777777777777777777',
      intent: { action: 'show' },
    };
    const context = {
      scope: workScope,
      taskSourceId: sourceId,
      enabled: true,
      clock: () => workNow,
    };
    assert.match(
      JSON.stringify(await runWorkPreview(db, { notion, discord }, input, context)),
      /Work conversation/,
    );
    const invalid = await runWorkPreview(
      db,
      { notion, discord },
      { ...input, intent: { action: 'unlink', url: 'https://example.com/not-notion' } },
      context,
    );
    assert.match(JSON.stringify(invalid), /valid Notion page URL/);
    assert.equal(
      db.raw.prepare("SELECT state FROM discord_work_conversations WHERE id='z-target'").get()
        ?.state,
      'active',
    );
    let membershipChecks = 0;
    Object.assign(discord, {
      membership: () => {
        membershipChecks++;
        if (membershipChecks === 2)
          db.raw
            .prepare(
              "UPDATE discord_work_conversations SET generation=2,data_json=json_set(data_json,'$.generation',2) WHERE id='z-target'",
            )
            .run();
        return Promise.resolve(true);
      },
    });
    const changed = await runWorkPreview(
      db,
      { notion, discord },
      { ...input, intent: { action: 'unlink' } },
      context,
    );
    assert.match(JSON.stringify(changed), /link changed/i);
    assert.equal(
      db.raw.prepare("SELECT state FROM discord_work_conversations WHERE id='z-target'").get()
        ?.state,
      'active',
    );
    db.raw
      .prepare(
        "UPDATE discord_work_conversations SET generation=1,data_json=json_set(data_json,'$.generation',1) WHERE id='z-target'",
      )
      .run();
    Object.assign(discord, { membership: () => Promise.resolve(true) });
    await runWorkPreview(
      db,
      { notion, discord },
      { ...input, intent: { action: 'unlink' } },
      context,
    );
    assert.equal(
      db.raw.prepare("SELECT state FROM discord_work_conversations WHERE id='z-target'").get()
        ?.state,
      'unlinked',
    );
  } finally {
    db.raw.close();
  }
});

void test('unlink does not choose between projects sharing a location', async () => {
  const { runWorkPreview } = await import('../src/discord-work-setup');
  const { db, notion } = workFixture();
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  Object.assign(discord, { membership: () => Promise.resolve(true) });
  const channelId = '333333333333333333';
  try {
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
      )
      .run(workNow.toISOString());
    for (const [id, pageId] of [
      ['one', projectId],
      ['two', '10000000-0000-4000-8000-000000000005'],
    ] as const)
      await saveProjectHome(
        db,
        {
          id,
          scope: workScope,
          projectSourceId,
          projectId: pageId,
          destination: { kind: 'forum', channelId, parentId: null },
          taskParent: null,
          audienceFingerprint: 'audience',
          approvedBy: 'guest',
          state: 'active',
          generation: 1,
        },
        0,
        workNow,
      );
    const input = {
      applicationId: '444444444444444444',
      guildId: workScope.guildId,
      discordUserId,
      channelId,
      interactionId: '777777777777777777',
      intent: { action: 'unlink' },
    };
    const result = await runWorkPreview(db, { notion, discord }, input, {
      scope: workScope,
      taskSourceId: sourceId,
      enabled: true,
      clock: () => workNow,
    });
    assert.match(JSON.stringify(result), /Several projects/);
    assert.equal(
      db.raw.prepare("SELECT count(*) AS n FROM discord_project_homes WHERE state='active'").get()
        ?.n,
      2,
    );
  } finally {
    db.raw.close();
  }
});
