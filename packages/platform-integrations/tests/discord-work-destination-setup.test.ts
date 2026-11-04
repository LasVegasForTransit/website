import assert from 'node:assert/strict';
import test from 'node:test';
import { claimWorkOperation } from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { runWorkPreview } from '../src/discord-work-setup';
import { processWorkDestination } from '../src/discord-work-destination';
import { discordUserId, sourceId, workFixture, workNow, workScope } from './support/discord-work';

void test('an administrator reviews and creates a category with server-wide permissions', async () => {
  const { db, notion } = workFixture();
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  let writes = 0;
  Object.assign(discord, {
    membership: () => Promise.resolve(true),
    inspectGuildPlacement: () =>
      Promise.resolve({ canManageChannels: true, audienceFingerprint: 'guild-audience' }),
    createRouteDestination: (input: { kind: string }) => {
      writes++;
      assert.equal(input.kind, 'category');
      return Promise.resolve({ channelId: '555555555555555555', parentId: null });
    },
  });
  const base = {
    applicationId: '444444444444444444',
    guildId: workScope.guildId,
    discordUserId,
    channelId: '333333333333333333',
    interactionId: '777777777777777777',
  };
  const context = { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => workNow };
  try {
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
      )
      .run(workNow.toISOString());
    const preview = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'create-category', name: 'Projects' } },
      context,
    );
    assert.match(JSON.stringify(preview), /server-wide permissions/);
    const receipt = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='destination'",
      )
      .get();
    assert.ok(receipt);
    await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'dest-confirm', linkId: String(receipt.id) } },
      context,
    );
    const op = await claimWorkOperation(db, workScope, workNow);
    assert.ok(op);
    assert.equal(
      (await processWorkDestination(db, { notion, discord }, op, context)).kind,
      'progress',
    );
    assert.equal(writes, 1);
    const status = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'destinations' } },
      context,
    );
    assert.match(JSON.stringify(status), /route-project/);
  } finally {
    db.raw.close();
  }
});

void test('an administrator reviews and creates an event destination once and can find it afterward', async () => {
  const { db, notion } = workFixture();
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  let writes = 0;
  Object.assign(discord, {
    membership: () => Promise.resolve(true),
    communityEnabled: () => Promise.resolve(true),
    inspectDestination: () =>
      Promise.resolve({
        isCategory: true,
        canRead: true,
        canManageChannels: true,
        audienceFingerprint: 'audience',
      }),
    createRouteDestination: () => {
      writes++;
      return Promise.resolve({ channelId: '555555555555555555', parentId: '333333333333333333' });
    },
  });
  const base = {
    applicationId: '444444444444444444',
    guildId: workScope.guildId,
    discordUserId,
    channelId: '333333333333333333',
    interactionId: '777777777777777777',
  };
  const context = { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => workNow };
  try {
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
      )
      .run(workNow.toISOString());
    const preview = await runWorkPreview(
      db,
      { notion, discord },
      {
        ...base,
        intent: { action: 'create-event-forum', name: 'Events', destinationId: base.channelId },
      },
      context,
    );
    assert.match(JSON.stringify(preview), /Review new forum/);
    assert.equal(writes, 0);
    const receipt = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='destination'",
      )
      .get();
    assert.ok(receipt);
    const confirm = { ...base, intent: { action: 'dest-confirm', linkId: String(receipt.id) } };
    assert.match(
      JSON.stringify(await runWorkPreview(db, { notion, discord }, confirm, context)),
      /Creation queued/,
    );
    assert.match(
      JSON.stringify(await runWorkPreview(db, { notion, discord }, confirm, context)),
      /already queued/,
    );
    assert.equal(writes, 0);
    const op = await claimWorkOperation(db, workScope, workNow);
    assert.ok(op);
    assert.equal(
      (await processWorkDestination(db, { notion, discord }, op, context)).kind,
      'progress',
    );
    assert.equal(writes, 1);
    const status = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'destinations' } },
      context,
    );
    assert.match(JSON.stringify(status), /555555555555555555/);
    assert.equal(
      db.raw
        .prepare(
          "SELECT count(*) AS n FROM discord_work_operations WHERE source_key LIKE 'destination:%'",
        )
        .get()?.n,
      1,
    );
  } finally {
    db.raw.close();
  }
});
