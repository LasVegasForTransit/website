import {
  beehiivRuntime,
  type BeehiivRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/beehiiv-runtime';
import {
  discordRuntime,
  type DiscordRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/discord-runtime';
import { membershipStep, canContinueMembership, type ScheduledBudget } from './scheduled-budget';

interface EnabledProviders {
  discord: boolean;
  newsletter: boolean;
}
async function scanProviders(
  context: ExecutionContext,
  enabled: EnabledProviders,
  budget: ScheduledBudget,
): Promise<boolean> {
  let failed = false;
  if (enabled.discord && canContinueMembership(budget)) {
    const result = await membershipStep(
      budget,
      'discord_scan',
      async () => await context.exports.DiscordScan.run(),
    );
    if (!result) {
      enabled.discord = false;
      failed = true;
    }
  }
  for (let page = 0; page < 5 && enabled.newsletter && canContinueMembership(budget); page++) {
    const result = await membershipStep(
      budget,
      'newsletter_scan',
      async () => await context.exports.NewsletterScan.run(),
    );
    if (!result || result.kind === 'paused') enabled.newsletter = false;
    if (!result) failed = true;
    if (result?.kind !== 'scanned' || result.complete) break;
  }
  return failed;
}
async function processIncoming(
  context: ExecutionContext,
  budget: ScheduledBudget,
): Promise<boolean> {
  for (let batch = 0; batch < 6 && canContinueMembership(budget); batch++) {
    const result = await membershipStep(
      budget,
      'newsletter_incoming',
      async () => await context.exports.NewsletterIncoming.run(),
    );
    if (!result || result.kind === 'failed') return true;
    if (result.kind === 'idle' || !result.more) break;
  }
  return false;
}
async function runAccount(context: ExecutionContext, newsletter: boolean, budget: ScheduledBudget) {
  if (newsletter) {
    const result = await membershipStep(
      budget,
      'newsletter_reconcile',
      async () => await context.exports.NewsletterAccount.run(),
    );
    return {
      stop: !result || result.kind === 'idle' || result.paused || result.kind === 'failed',
      failed: !result || result.kind === 'failed',
    };
  }
  const result = await membershipStep(
    budget,
    'discord_reconcile',
    async () => await context.exports.DiscordAccount.run(),
  );
  return {
    stop: !result?.selected || result.paused || result.failed,
    failed: !result || result.failed,
  };
}

export async function runScheduledMembership(
  controller: ScheduledController,
  env: Env & BeehiivRuntimeEnv & DiscordRuntimeEnv,
  context: ExecutionContext,
): Promise<void> {
  // The scheduled parent is one of the 32 invocations; completion always gets a reserved call.
  const budget = { remaining: 31, deadline: Date.now() + 50_000 };
  const records = await membershipStep(budget, 'staff_maintenance', () =>
    context.exports.StaffMaintenance.run(controller.scheduledTime),
  );
  const profiles = await membershipStep(budget, 'profile_maintenance', () =>
    context.exports.ProfileMaintenance.run(controller.scheduledTime),
  );
  const enabled = {
    discord: Boolean(discordRuntime(env)),
    newsletter: Boolean(beehiivRuntime(env)),
  };
  const incomingFailed = enabled.newsletter ? await processIncoming(context, budget) : false;
  const scanFailed = await scanProviders(context, enabled, budget);
  let failed = incomingFailed || scanFailed || !records || !profiles;
  for (
    let slot = 0;
    canContinueMembership(budget) && (enabled.discord || enabled.newsletter);
    slot++
  ) {
    const newsletter = enabled.newsletter && (!enabled.discord || slot % 2 === 1);
    const result = await runAccount(context, newsletter, budget);
    if (result.stop) enabled[newsletter ? 'newsletter' : 'discord'] = false;
    if (result.failed) failed = true;
  }
  const completion = await membershipStep(budget, 'provider_completion', () =>
    context.exports.ProviderCompletion.run(controller.scheduledTime),
  );
  if (failed || !completion) throw new Error('Scheduled membership work failed');
}
