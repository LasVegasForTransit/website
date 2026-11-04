import assert from 'node:assert/strict';
import test from 'node:test';
import {
  saveProjectHome,
  readProjectHome,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { runWorkPreview } from '../src/discord-work-setup';
import {
  discordUserId,
  projectId,
  projectSourceId,
  sourceId,
  workFixture,
  workNow,
  workScope,
} from './support/discord-work';

void test('an administrator chooses event tags for an existing project forum', async () => {
  const { db, notion } = workFixture();
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  const forumId = '555555555555555555',
    categoryId = '333333333333333333',
    tagId = '888888888888888888';
  let tags = [{ id: tagId, name: 'Event' }];
  Object.assign(discord, {
    membership: () => Promise.resolve(true),
    inspectDestination: () =>
      Promise.resolve({
        isCategory: false,
        destination: { kind: 'forum', channelId: forumId, parentId: categoryId },
        audienceFingerprint: 'audience',
        canRead: true,
        canSend: true,
        requiredTag: true,
        tags,
      }),
  });
  const base = {
    applicationId: '444444444444444444',
    guildId: workScope.guildId,
    discordUserId,
    channelId: forumId,
    interactionId: '777777777777777777',
  };
  const context = { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => workNow };
  try {
    await saveProjectHome(
      db,
      {
        id: 'project',
        scope: workScope,
        projectSourceId,
        projectId,
        destination: { kind: 'forum', channelId: forumId, parentId: categoryId },
        taskParent: null,
        audienceFingerprint: 'audience',
        approvedBy: 'guest',
        state: 'active',
        generation: 1,
      },
      0,
      workNow,
    );
    const denied = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'project-event-tags', destinationId: forumId } },
      context,
    );
    assert.match(JSON.stringify(denied), /Administrator access is required/);
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
      )
      .run(workNow.toISOString());
    const picker = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'project-event-tags', destinationId: forumId } },
      context,
    );
    assert.match(JSON.stringify(picker), /Choose event tags/);
    const receipt = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='project-event-tags' ORDER BY rowid DESC LIMIT 1",
      )
      .get();
    assert.ok(receipt);
    tags = [];
    const stale = await runWorkPreview(
      db,
      { notion, discord },
      {
        ...base,
        intent: { action: 'project-tag-save', linkId: String(receipt.id), values: [tagId] },
      },
      context,
    );
    assert.match(JSON.stringify(stale), /changed/);
    assert.equal((await readProjectHome(db, workScope, 'project'))?.eventForumTags, undefined);
    tags = [{ id: tagId, name: 'Event' }];
    const saved = await runWorkPreview(
      db,
      { notion, discord },
      {
        ...base,
        intent: { action: 'project-tag-save', linkId: String(receipt.id), values: [tagId] },
      },
      context,
    );
    assert.match(JSON.stringify(saved), /Event tags saved/);
    assert.deepEqual((await readProjectHome(db, workScope, 'project'))?.eventForumTags, {
      forumId,
      tagIds: [tagId],
    });
  } finally {
    db.raw.close();
  }
});
