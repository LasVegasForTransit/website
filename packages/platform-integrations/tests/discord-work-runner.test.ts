import assert from 'node:assert/strict';
import test from 'node:test';
import { workFixture, workScope, workNow, sourceId } from './support/discord-work';
import { DiscordWorkClient } from '../src/discord-work-provider';
void test('disabled shared work invokes no providers and does not depend on personal check-ins', async () => {
  const module = await import('../src/discord-work-runner').catch(() => null);
  assert.ok(module, 'bounded work runner exists');
  const { db, notion } = workFixture();
  let calls = 0;
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
    fetch: () => {
      calls++;
      return Promise.reject(new Error('unexpected provider call'));
    },
  });
  try {
    const result = await module.runDiscordWorkBatch(
      db,
      { notion, discord },
      {
        scope: workScope,
        taskSourceId: sourceId,
        enabled: false,
        clock: () => workNow,
        stage: 'ingest',
        deadline: workNow.getTime() + 1000,
        maxLinks: 1,
        maxEffects: 1,
      },
    );
    assert.equal(result.kind, 'idle');
    assert.equal(calls, 0);
  } finally {
    db.raw.close();
  }
});
