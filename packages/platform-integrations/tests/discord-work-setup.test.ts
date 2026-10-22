import assert from 'node:assert/strict';
import test from 'node:test';
import { DiscordWorkClient } from '../src/discord-work-provider';
import {
  workFixture,
  workScope,
  workNow,
  sourceId,
  projectId,
  discordUserId,
} from './support/discord-work';
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
