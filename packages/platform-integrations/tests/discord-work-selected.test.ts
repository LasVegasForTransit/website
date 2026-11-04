import assert from 'node:assert/strict';
import test from 'node:test';
import { saveProjectHome } from '@lasvegasfortransit/platform-storage/discord-work-links';
import { claimWorkOperation } from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { resolveWorkActor } from '../src/discord-work-authority';
import { setupReceipt } from '../src/discord-work-setup-common';
import { runWorkPreview } from '../src/discord-work-setup';
import { processWorkAction } from '../src/discord-work-actions';
import { DiscordWorkClient } from '../src/discord-work-provider';
import {
  workFixture,
  workScope,
  workNow,
  sourceId,
  taskId,
  projectId,
  projectSourceId,
  discordUserId,
} from './support/discord-work';
void test('a selected message previews attribution and saves once without requiring a task thread', async () => {
  const { db, notion } = workFixture(),
    comments: unknown[] = [];
  const channelId = '333333333333333333';
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  Object.assign(discord, {
    membership: () => Promise.resolve(true),
    inspectDestination: () =>
      Promise.resolve({ audienceFingerprint: 'audience', canRead: true, locked: false }),
  });
  Object.assign(notion, {
    createTaskComment: (_page: string, rich: unknown) => {
      comments.push(rich);
      return Promise.resolve({ object: 'comment', id: 'comment' });
    },
  });
  const context = { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => workNow };
  const request = {
    applicationId: '444444444444444444',
    guildId: workScope.guildId,
    discordUserId,
    channelId,
    interactionId: '666666666666666666',
    intent: { action: 'save-target', value: taskId },
  };
  try {
    db.raw.prepare("UPDATE people SET given_name='Alex' WHERE id='guest'").run();
    await saveProjectHome(
      db,
      {
        id: 'home',
        scope: workScope,
        projectSourceId,
        projectId,
        taskSourceId: sourceId,
        destination: { kind: 'text', channelId, parentId: null },
        taskParent: null,
        audienceFingerprint: 'audience',
        approvedBy: 'guest',
        state: 'active',
        generation: 1,
      },
      0,
      workNow,
    );
    const actor = await resolveWorkActor(db, workScope, discordUserId);
    assert.ok(actor);
    const subject = { kind: 'task', sourceId, pageId: taskId };
    const picker = await setupReceipt(
      db,
      {
        request,
        actor,
        payload: {
          intent: 'save-target',
          homeId: 'home',
          targets: [{ title: 'Prepare agenda', subject }],
          message: {
            id: '555555555555555555',
            channelId,
            authorId: '777777777777777777',
            authorName: 'Sam',
            createdAt: workNow.toISOString(),
            text: 'The room is confirmed.',
            bot: false,
            webhook: false,
            system: false,
            contentAvailable: true,
            attachmentOnly: false,
          },
        },
      },
      context,
    );
    const preview = await runWorkPreview(
      db,
      { notion, discord },
      { ...request, intent: { ...request.intent, linkId: picker.id } },
      context,
    );
    assert.equal(preview.kind, 'ready');
    assert.match(JSON.stringify(preview), /Sam/);
    assert.match(JSON.stringify(preview), /Submitted by/);
    const receipt = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='comment'",
      )
      .get();
    assert.ok(receipt);
    const confirmation = { ...request, intent: { action: 'confirm', linkId: String(receipt.id) } };
    await runWorkPreview(db, { notion, discord }, confirmation, context);
    await runWorkPreview(db, { notion, discord }, confirmation, context);
    const op = await claimWorkOperation(db, workScope, workNow);
    assert.ok(op);
    assert.equal(op.conversation_id, null);
    assert.equal((await processWorkAction(db, { notion, discord }, op, context)).kind, 'progress');
    assert.equal(comments.length, 1);
    assert.match(JSON.stringify(comments[0]), /Sam/);
    assert.match(JSON.stringify(comments[0]), /Alex/);
    assert.match(JSON.stringify(comments[0]), /555555555555555555/);
    assert.equal(await claimWorkOperation(db, workScope, workNow), null);
  } finally {
    db.raw.close();
  }
});

void test('saving a message finds the project in its current channel beyond 50 unrelated projects', async () => {
  const { db, notion } = workFixture();
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  Object.assign(discord, { membership: () => Promise.resolve(true) });
  Object.assign(notion, {
    queryTasksForProject: () => Promise.resolve({ results: [], nextCursor: null }),
  });
  const channelId = '333333333333333333';
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
          destination: {
            kind: 'text',
            channelId: i === 50 ? channelId : String(600000000000000000n + BigInt(i)),
            parentId: null,
          },
          taskParent: null,
          audienceFingerprint: 'audience',
          approvedBy: 'guest',
          state: 'active',
          generation: 1,
          title: i === 50 ? 'Target project' : 'Other',
        },
        0,
        workNow,
      );
    }
    const message = {
      id: '555555555555555555',
      channelId,
      authorId: discordUserId,
      authorName: 'Volunteer',
      createdAt: workNow.toISOString(),
      text: 'Update',
      bot: false,
      webhook: false,
      system: false,
      contentAvailable: true,
      attachmentOnly: false,
    };
    const result = await runWorkPreview(
      db,
      { notion, discord },
      {
        applicationId: '444444444444444444',
        guildId: workScope.guildId,
        discordUserId,
        channelId,
        interactionId: '777777777777777777',
        intent: { action: 'save-message', message },
      },
      { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => workNow },
    );
    assert.match(JSON.stringify(result), /Target project/);
  } finally {
    db.raw.close();
  }
});
