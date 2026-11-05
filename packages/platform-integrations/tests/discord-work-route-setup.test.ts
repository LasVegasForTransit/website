import assert from 'node:assert/strict';
import test from 'node:test';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { runWorkPreview } from '../src/discord-work-setup';
import { discordUserId, sourceId, workFixture, workNow, workScope } from './support/discord-work';

void test('project route setup rejects a source that was not offered to the administrator', async () => {
  const { db, notion } = workFixture();
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  Object.assign(notion, {
    searchDataSources: () =>
      Promise.resolve({
        results: [
          { object: 'data_source', id: sourceId, title: [{ plain_text: 'Other database' }] },
        ],
        nextCursor: null,
      }),
  });
  Object.assign(discord, { membership: () => Promise.resolve(true) });
  const context = { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => workNow };
  const base = {
    applicationId: '444444444444444444',
    guildId: workScope.guildId,
    discordUserId,
    channelId: '333333333333333333',
    interactionId: '777777777777777777',
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
      { ...base, intent: { action: 'route-project' } },
      context,
    );
    const receipt = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route-setup'",
      )
      .get();
    assert.ok(receipt);
    const result = await runWorkPreview(
      db,
      { notion, discord },
      {
        ...base,
        intent: {
          action: 'route-source',
          linkId: String(receipt.id),
          value: '10000000-0000-4000-8000-000000000099',
        },
      },
      context,
    );
    assert.match(JSON.stringify(result), /Choose a source from the list/);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM discord_work_routes').get()?.n, 0);
  } finally {
    db.raw.close();
  }
});
