import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { DiscordAccess } from '../src/discord-access';
const applicationId = '111111111111111111';
const configuration = {
  environment: 'preview' as const,
  guildId: '333333333333333333',
  productionGuildId: '999999999999999999',
  botToken: 'fixture-only',
};
void test('a 429 pauses a fresh runner instance until the saved deadline, and an older delay cannot shorten it', async () => {
  const loaded = await import('../src/discord-rate-limit').catch(() => null);
  assert.ok(loaded, 'scheduled Discord work needs shared durable retry timing');
  const db = memoryDb();
  let clock = Date.now();
  const now = () => new Date(clock);
  const rateLimit = loaded.discordRateLimit(db, applicationId, now);
  let calls = 0;
  const fetcher: typeof fetch = () => {
    calls += 1;
    return Promise.resolve(Response.json({ retry_after: 2.75, global: true }, { status: 429 }));
  };
  const client = new DiscordAccess(configuration, { fetch: fetcher, rateLimit, now: () => clock });
  await assert.rejects(client.readMember('222222222222222222'), {
    kind: 'rate_limited',
    retryAfterMs: 2750,
  });
  const restarted = new DiscordAccess(configuration, {
    fetch: fetcher,
    rateLimit: loaded.discordRateLimit(db, applicationId, now),
    now: () => clock,
  });
  await assert.rejects(restarted.readMember('444444444444444444'), {
    kind: 'rate_limited',
    global: true,
  });
  assert.equal(calls, 1);
  await rateLimit.defer({ retryAfterMs: 1000, global: false });
  clock += 2749;
  assert.equal((await rateLimit.current())?.retryAfterMs, 1);
  clock += 1;
  assert.equal(await rateLimit.current(), null);
  await assert.rejects(restarted.readMember('444444444444444444'), { kind: 'rate_limited' });
  assert.equal(calls, 2);
});
void test('the shared pause is isolated by Discord application and rejects invalid deadlines', async () => {
  const loaded = await import('../src/discord-rate-limit').catch(() => null);
  assert.ok(loaded);
  const db = memoryDb();
  const rateLimit = loaded.discordRateLimit(db, applicationId);
  await rateLimit.defer({ retryAfterMs: 60_000, global: false });
  assert.equal(await loaded.discordRateLimit(db, '555555555555555555').current(), null);
  for (const retryAfterMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 86_400_001])
    await assert.rejects(rateLimit.defer({ retryAfterMs, global: false }));
  assert.ok((await rateLimit.current())?.retryAfterMs);
});
