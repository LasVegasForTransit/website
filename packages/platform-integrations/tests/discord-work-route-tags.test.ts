import assert from 'node:assert/strict';
import test from 'node:test';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { runWorkPreview } from '../src/discord-work-setup';
import { discordUserId, sourceId, workFixture, workNow, workScope } from './support/discord-work';

for (const choice of ['tag', 'skip', 'required'] as const) {
  void test(`event forum setup handles ${choice} tag selection`, async () => {
    const { db, notion } = workFixture();
    const discord = new DiscordWorkClient({
      guildId: workScope.guildId,
      applicationId: '444444444444444444',
      botToken: 'fixture-only',
    });
    Object.assign(notion, {
      searchDataSources: () =>
        Promise.resolve({
          results: [{ object: 'data_source', id: sourceId, title: [{ plain_text: 'Events' }] }],
          nextCursor: null,
        }),
      readDataSource: () =>
        Promise.resolve({
          object: 'data_source',
          id: sourceId,
          title: [{ plain_text: 'Events' }],
          properties: {
            Status: {
              type: 'status',
              status: { options: [{ name: 'Planning' }, { name: 'Pending review' }] },
            },
          },
        }),
    });
    Object.assign(discord, {
      membership: () => Promise.resolve(true),
      inspectDestination: () =>
        Promise.resolve({
          isCategory: false,
          destination: { kind: 'forum', channelId: '333333333333333333', parentId: null },
          audienceFingerprint: 'audience',
          archived: false,
          locked: false,
          canRead: true,
          canSend: true,
          canCreateThreads: false,
          canManageChannels: false,
          requiredTag: choice === 'required',
          tags: [
            { id: '666666666666666666', name: 'Events' },
            { id: '888888888888888888', name: 'Outreach' },
          ],
        }),
    });
    const base = {
      applicationId: '444444444444444444',
      guildId: workScope.guildId,
      discordUserId,
      channelId: '333333333333333333',
      interactionId: '777777777777777777',
    };
    const context = {
      scope: workScope,
      taskSourceId: sourceId,
      enabled: true,
      clock: () => workNow,
    };
    try {
      db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
      db.raw
        .prepare(
          "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
        )
        .run(workNow.toISOString());
      await runWorkPreview(
        db,
        { notion, discord },
        { ...base, intent: { action: 'route-event', destinationId: base.channelId } },
        context,
      );
      const receipt = db.raw
        .prepare(
          "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route-setup'",
        )
        .get();
      assert.ok(receipt);
      const linkId = String(receipt.id);
      await runWorkPreview(
        db,
        { notion, discord },
        { ...base, intent: { action: 'route-source', linkId, value: sourceId } },
        context,
      );
      const picker = await runWorkPreview(
        db,
        { notion, discord },
        { ...base, intent: { action: 'route-choice', linkId, values: ['0', '1'] } },
        context,
      );
      assert.match(JSON.stringify(picker), /forum tag/i);
      assert.match(JSON.stringify(picker), /"max_values":2/);
      if (choice === 'required') {
        assert.doesNotMatch(JSON.stringify(picker), /Continue without a tag/);
        const skip = await runWorkPreview(
          db,
          { notion, discord },
          { ...base, intent: { action: 'route-skip-tag', linkId } },
          context,
        );
        assert.match(JSON.stringify(skip), /required forum tag/);
        return;
      }
      assert.match(JSON.stringify(picker), /Continue without a tag/);
      const action =
        choice === 'tag'
          ? {
              action: 'route-tag',
              linkId,
              value: '666666666666666666',
              values: ['666666666666666666', '888888888888888888'],
            }
          : { action: 'route-skip-tag', linkId };
      const review = await runWorkPreview(
        db,
        { notion, discord },
        { ...base, intent: action },
        context,
      );
      assert.match(JSON.stringify(review), /Review route/);
      assert.match(JSON.stringify(review), /Pending review/);
      if (choice === 'tag') assert.match(JSON.stringify(review), /Outreach/);
      const approval = db.raw
        .prepare(
          "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route'",
        )
        .get();
      assert.ok(approval);
      await runWorkPreview(
        db,
        { notion, discord },
        { ...base, intent: { action: 'route-approve', linkId: String(approval.id) } },
        context,
      );
      const row = db.raw
        .prepare("SELECT json_extract(data_json,'$.tagIds') AS tags FROM discord_work_routes")
        .get();
      assert.equal(
        db.raw
          .prepare(
            "SELECT json_extract(data_json,'$.trigger.values[1]') AS value FROM discord_work_routes",
          )
          .get()?.value,
        'Pending review',
      );
      assert.deepEqual(
        JSON.parse(String(row?.tags)),
        choice === 'tag' ? ['666666666666666666', '888888888888888888'] : [],
      );
    } finally {
      db.raw.close();
    }
  });
}
