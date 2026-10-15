import assert from 'node:assert/strict';
import test from 'node:test';
import { runScheduledMembership } from '../src/scheduled';

function fixture(
  failedStep?: string,
  onStep?: (name: string) => void,
  options: {
    busyInbox?: boolean;
    scanComplete?: boolean;
    paused?: boolean;
    scheduledTime?: number;
  } = {},
) {
  const visits: string[] = [];
  const step = (name: string, result: object) => ({
    run: () => {
      visits.push(name);
      onStep?.(name);
      return name === failedStep
        ? Promise.reject(new Error('private provider error must not be logged'))
        : Promise.resolve(result);
    },
  });
  const context = {
    exports: {
      StaffMaintenance: step('records', {}),
      ProfileMaintenance: step('profiles', {}),
      InactiveProfileMaintenance: step('inactive_profiles', {}),
      ProviderCompletion: step('completion', {}),
      DiscordScan: step('discord_scan', {}),
      NewsletterScan: step('newsletter_scan', {
        kind: options.paused ? 'paused' : 'scanned',
        complete: options.scanComplete ?? true,
      }),
      NewsletterIncoming: step('newsletter_incoming', {
        kind: options.busyInbox ? 'progress' : 'idle',
        more: options.busyInbox ?? false,
      }),
      NewsletterPollingChoices: step('newsletter_poll_choices', { kind: 'idle', more: false }),
      DiscordAccount: step('discord_account', { selected: 1, failed: false, paused: false }),
      NewsletterAccount: step('newsletter_account', { kind: 'progress', paused: false }),
    },
  } as unknown as ExecutionContext;
  const env = {
    LVBT_DEPLOYMENT_ENV: 'preview',
    LVBT_DISCORD_SYNC_ENABLED: 'true',
    LVBT_DISCORD_APPLICATION_ID: '555555555555555555',
    LVBT_DISCORD_GUILD_ID: '111111111111111111',
    LVBT_DISCORD_PRODUCTION_GUILD_ID: '999999999999999999',
    LVBT_DISCORD_MEMBER_ROLE_ID: '333333333333333333',
    LVBT_DISCORD_BOT_TOKEN: 'fixture-only',
    LVBT_BEEHIIV_SYNC_ENABLED: 'true',
    LVBT_BEEHIIV_PUBLICATION_ID: 'pub_preview',
    LVBT_BEEHIIV_PRODUCTION_PUBLICATION_ID: 'pub_production',
    LVBT_BEEHIIV_API_KEY: 'fixture-only',
    LVBT_NEWSLETTER_INTENT_KEY: 'a'.repeat(43),
    LVBT_BEEHIIV_WEBHOOK_SECRET: `whsec_${btoa('fixture-event-key-only')}`,
  } as unknown as Env;
  const controller = { scheduledTime: options.scheduledTime ?? Date.now() } as ScheduledController;
  return { visits, run: () => runScheduledMembership(controller, env, context) };
}
void test('daily privacy work starts at03:00 Pacific and remains inside the invocation allowance', async () => {
  for (const [time, expected] of [
    ['2026-10-14T09:59:00Z', false],
    ['2026-10-14T10:00:00Z', true],
  ] as const) {
    const f = fixture(undefined, undefined, { scheduledTime: Date.parse(time) });
    await f.run();
    assert.equal(f.visits.includes('inactive_profiles'), expected);
    assert.ok(f.visits.length + 1 <= 32);
    assert.equal(f.visits.at(-1), 'completion');
  }
});

void test('both busy providers get work within the 32-invocation request limit', async () => {
  const f = fixture();
  await f.run();
  assert.ok(f.visits.length + 1 <= 32, 'include the scheduled parent invocation');
  const discord = f.visits.filter((name) => name === 'discord_account').length;
  const newsletter = f.visits.filter((name) => name === 'newsletter_account').length;
  assert.ok(discord > 0 && newsletter > 0);
  assert.ok(Math.abs(discord - newsletter) <= 1);
  assert.equal(f.visits.at(-1), 'completion');
});
void test('ready newsletter choices are processed before any outgoing provider work', async () => {
  const f = fixture(undefined, undefined, { busyInbox: true });
  await f.run();
  assert.ok(f.visits.includes('newsletter_incoming'));
  for (const provider of ['discord', 'newsletter'])
    assert.ok(f.visits.indexOf('newsletter_incoming') < f.visits.indexOf(`${provider}_account`));
  assert.equal(f.visits.at(-1), 'completion');
});
void test('a large roster advances five pages while a busy inbox and both providers keep moving within the request limit', async () => {
  const f = fixture(undefined, undefined, { busyInbox: true, scanComplete: false });
  await f.run();
  assert.equal(f.visits.filter((name) => name === 'newsletter_scan').length, 5);
  assert.equal(f.visits.filter((name) => name === 'newsletter_incoming').length, 6);
  assert.ok(f.visits.length + 1 <= 32);
  const discord = f.visits.filter((name) => name === 'discord_account').length;
  const newsletter = f.visits.filter((name) => name === 'newsletter_account').length;
  assert.ok(discord > 0 && newsletter > 0);
  assert.ok(Math.abs(discord - newsletter) <= 1);
});
void test('a provider pause stops outgoing newsletter calls but still processes saved choices', async () => {
  const f = fixture(undefined, undefined, { busyInbox: true, paused: true });
  await f.run();
  assert.ok(f.visits.includes('newsletter_incoming'));
  assert.equal(f.visits.includes('newsletter_account'), false);
  assert.ok(f.visits.includes('discord_account'));
  assert.equal(f.visits.at(-1), 'completion');
});
void test('incoming storage failure still allows unrelated outgoing work and final completion', async () => {
  const f = fixture('newsletter_incoming');
  await assert.rejects(f.run(), /Scheduled membership work failed/);
  assert.ok(f.visits.includes('discord_account'));
  assert.ok(f.visits.includes('newsletter_account'));
  assert.equal(f.visits.at(-1), 'completion');
});
void test('slow account work stops new steps after the selection deadline and still completes', async (t) => {
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  const f = fixture(undefined, (name) => {
    if (name.endsWith('_account')) clock += 30_000;
  });
  await f.run();
  assert.equal(f.visits.filter((name) => name.endsWith('_account')).length, 2);
  assert.equal(f.visits.at(-1), 'completion');
});
for (const provider of ['discord', 'newsletter']) {
  void test(`${provider} scan exceptions still allow the other provider and completion`, async () => {
    const f = fixture(`${provider}_scan`);
    await assert.rejects(f.run(), /Scheduled membership work failed/);
    const other = provider === 'discord' ? 'newsletter' : 'discord';
    assert.equal(f.visits.includes(`${other}_account`), true);
    assert.equal(f.visits.includes(`${provider}_account`), false);
    assert.equal(f.visits.at(-1), 'completion');
  });
  void test(`${provider} account exceptions still allow the other provider and completion`, async () => {
    const f = fixture(`${provider}_account`);
    await assert.rejects(f.run(), /Scheduled membership work failed/);
    const other = provider === 'discord' ? 'newsletter' : 'discord';
    assert.equal(f.visits.includes(`${other}_account`), true);
    assert.equal(f.visits.filter((name) => name === `${provider}_account`).length, 1);
    assert.equal(f.visits.at(-1), 'completion');
  });
}
