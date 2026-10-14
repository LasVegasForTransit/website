import assert from 'node:assert/strict';
import test from 'node:test';
import { runScheduledMembership } from '../src/scheduled';

function fixture(failedStep?: string, onStep?: (name: string) => void) {
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
      ProviderCompletion: step('completion', {}),
      DiscordScan: step('discord_scan', {}),
      NewsletterScan: step('newsletter_scan', { kind: 'scanned' }),
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
  } as unknown as Env;
  const controller = { scheduledTime: Date.now() } as ScheduledController;
  return { visits, run: () => runScheduledMembership(controller, env, context) };
}

void test('both busy providers get work within the 32-invocation request limit', async () => {
  const f = fixture();
  await f.run();
  assert.equal(f.visits.length + 1, 30, 'include the scheduled parent invocation');
  assert.equal(f.visits.filter((name) => name === 'discord_account').length, 12);
  assert.equal(f.visits.filter((name) => name === 'newsletter_account').length, 12);
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
