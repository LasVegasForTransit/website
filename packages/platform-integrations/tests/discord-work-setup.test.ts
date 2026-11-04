import assert from 'node:assert/strict';
import test from 'node:test';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { saveProjectHome } from '@lasvegasfortransit/platform-storage/discord-work-links';
import { enqueueWorkOperation } from '@lasvegasfortransit/platform-storage/discord-work-operations';
import {
  workFixture,
  workScope,
  workNow,
  sourceId,
  projectId,
  discordUserId,
  projectSourceId,
} from './support/discord-work';

void test('project setup requires an explicit text fallback and checks forum creation readiness', async () => {
  const { runWorkPreview } = await import('../src/discord-work-setup');
  const { db, notion } = workFixture();
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  let category = false,
    manage = false,
    privateThread = false;
  Object.assign(discord, {
    membership: () => Promise.resolve(true),
    communityEnabled: () => Promise.resolve(true),
    inspectDestination: () =>
      Promise.resolve({
        isCategory: category,
        privateThread,
        destination: {
          kind: category ? 'forum' : privateThread ? 'thread' : 'text',
          channelId: '333333333333333333',
          parentId: null,
        },
        audienceFingerprint: 'audience',
        canRead: true,
        canSend: true,
        canManageChannels: manage,
        archived: false,
        locked: false,
        requiredTag: false,
        tags: [],
      }),
  });
  const input = {
    applicationId: '444444444444444444',
    guildId: workScope.guildId,
    discordUserId,
    channelId: '333333333333333333',
    interactionId: '777777777777777777',
    intent: { action: 'link', url: `https://www.notion.so/${projectId}` },
  };
  const context = { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => workNow };
  try {
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
      )
      .run(workNow.toISOString());
    const implicit = await runWorkPreview(db, { notion, discord }, input, context);
    assert.match(JSON.stringify(implicit), /select it explicitly/);
    assert.equal(
      db.raw
        .prepare("SELECT count(*) AS n FROM discord_work_operations WHERE state='preview'")
        .get()?.n,
      0,
    );
    const explicit = await runWorkPreview(
      db,
      { notion, discord },
      { ...input, intent: { ...input.intent, destinationId: input.channelId } },
      context,
    );
    assert.match(JSON.stringify(explicit), /instead of a dedicated project forum/);
    category = true;
    const denied = await runWorkPreview(
      db,
      { notion, discord },
      { ...input, intent: { ...input.intent, destinationId: input.channelId } },
      context,
    );
    assert.match(JSON.stringify(denied), /Manage Channels/);
    manage = true;
    const allowed = await runWorkPreview(
      db,
      { notion, discord },
      { ...input, intent: { ...input.intent, destinationId: input.channelId } },
      context,
    );
    assert.match(JSON.stringify(allowed), /forum/i);
    category = false;
    privateThread = true;
    const privateResult = await runWorkPreview(
      db,
      { notion, discord },
      { ...input, intent: { ...input.intent, destinationId: input.channelId } },
      context,
    );
    assert.match(JSON.stringify(privateResult), /private thread/i);
  } finally {
    db.raw.close();
  }
});

void test('show explains an edited Notion footer needs review', async () => {
  const { runWorkPreview } = await import('../src/discord-work-setup');
  const { db, notion } = workFixture();
  const channelId = '333333333333333333';
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  Object.assign(discord, { membership: () => Promise.resolve(true) });
  try {
    await saveProjectHome(
      db,
      {
        id: 'home',
        scope: workScope,
        projectSourceId,
        projectId,
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
    await enqueueWorkOperation(
      db,
      {
        id: 'backlink',
        scope: workScope,
        homeId: 'home',
        conversationId: null,
        generation: 1,
        kind: 'backlink',
        sourceKey: 'backlink:home',
        actorPersonId: 'guest',
        actorDiscordId: discordUserId,
        originalAuthorId: discordUserId,
        grantVersion: 'grant',
        payload: {},
      },
      workNow,
    );
    db.raw
      .prepare(
        "UPDATE discord_work_operations SET state='held',reason='footer_modified' WHERE id='backlink'",
      )
      .run();
    const result = await runWorkPreview(
      db,
      { notion, discord },
      {
        applicationId: '444444444444444444',
        guildId: workScope.guildId,
        discordUserId,
        channelId,
        interactionId: '777777777777777777',
        intent: { action: 'show' },
      },
      { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => workNow },
    );
    assert.match(JSON.stringify(result), /Notion footer.*edited/i);
    assert.doesNotMatch(JSON.stringify(result), /waiting for confirmation/i);
  } finally {
    db.raw.close();
  }
});
void test('project setup stays a private actor-bound preview until an enabled confirmation', async () => {
  const module = await import('../src/discord-work-setup').catch(() => null);
  assert.ok(module, 'native project setup exists');
  const { db, notion } = workFixture();
  db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
  db.raw
    .prepare(
      "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
    )
    .run(workNow.toISOString());
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  Object.assign(discord, {
    membership: () => Promise.resolve(true),
    inspectDestination: () =>
      Promise.resolve({
        destination: { kind: 'forum', channelId: '333333333333333333', parentId: null },
        audienceFingerprint: 'audience',
        canRead: true,
        canSend: true,
        requiredTag: false,
        tags: [],
      }),
  });
  const context = {
    scope: workScope,
    taskSourceId: sourceId,
    enabled: false,
    clock: () => workNow,
  };
  const input = {
    applicationId: '444444444444444444',
    guildId: workScope.guildId,
    discordUserId,
    channelId: '333333333333333333',
    interactionId: '777777777777777777',
    intent: { action: 'link', url: `https://www.notion.so/${projectId}` },
  };
  try {
    assert.equal(
      (await module.runWorkPreview(db, { notion, discord }, input, context)).kind,
      'ready',
    );
    const row = db.raw
      .prepare("SELECT id FROM discord_work_operations WHERE state='preview'")
      .get();
    assert.ok(row);
    const confirm = {
      ...input,
      intent: { action: 'confirm', linkId: String(row.id), generation: 1 },
    };
    await module.runWorkPreview(db, { notion, discord }, confirm, context);
    assert.equal(
      db.raw.prepare("SELECT count(*) AS n FROM discord_work_operations WHERE state='queued'").get()
        ?.n,
      0,
    );
    await module.runWorkPreview(
      db,
      { notion, discord },
      { ...confirm, discordUserId: '888888888888888888' },
      { ...context, enabled: true },
    );
    assert.equal(
      db.raw.prepare("SELECT count(*) AS n FROM discord_work_operations WHERE state='queued'").get()
        ?.n,
      0,
    );
    await module.runWorkPreview(db, { notion, discord }, confirm, { ...context, enabled: true });
    await module.runWorkPreview(db, { notion, discord }, confirm, { ...context, enabled: true });
    assert.equal(
      db.raw.prepare("SELECT count(*) AS n FROM discord_work_operations WHERE state='queued'").get()
        ?.n,
      1,
    );
  } finally {
    db.raw.close();
  }
});
