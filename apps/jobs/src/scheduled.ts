import {
  beehiivRuntime,
  type BeehiivRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/beehiiv-runtime';
import {
  discordRuntime,
  type DiscordRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/discord-runtime';
import { scheduledStep } from './scheduled-step';

interface EnabledProviders {
  discord: boolean;
  newsletter: boolean;
}
async function scanProviders(
  context: ExecutionContext,
  enabled: EnabledProviders,
): Promise<boolean> {
  let failed = false;
  if (enabled.discord) {
    const result = await scheduledStep(
      'discord_scan',
      async () => await context.exports.DiscordScan.run(),
    );
    if (!result) {
      enabled.discord = false;
      failed = true;
    }
  }
  if (enabled.newsletter) {
    const result = await scheduledStep(
      'newsletter_scan',
      async () => await context.exports.NewsletterScan.run(),
    );
    if (!result || result.kind === 'paused') enabled.newsletter = false;
    if (!result) failed = true;
  }
  return failed;
}
async function runAccount(context: ExecutionContext, newsletter: boolean) {
  if (newsletter) {
    const result = await scheduledStep(
      'newsletter_reconcile',
      async () => await context.exports.NewsletterAccount.run(),
    );
    return {
      stop: !result || result.kind === 'idle' || result.paused || result.kind === 'failed',
      failed: !result || result.kind === 'failed',
    };
  }
  const result = await scheduledStep(
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
  const deadline = Date.now() + 50_000;
  const records = await scheduledStep('staff_maintenance', () =>
    context.exports.StaffMaintenance.run(controller.scheduledTime),
  );
  const profiles = await scheduledStep('profile_maintenance', () =>
    context.exports.ProfileMaintenance.run(controller.scheduledTime),
  );
  const enabled = {
    discord: Boolean(discordRuntime(env)),
    newsletter: Boolean(beehiivRuntime(env)),
  };
  let failed = await scanProviders(context, enabled);
  failed = failed || !records || !profiles;
  // Include the parent, two maintenance passes, two scans and completion in the 32-call limit.
  for (
    let slot = 0;
    slot < 24 && Date.now() < deadline && (enabled.discord || enabled.newsletter);
    slot++
  ) {
    const newsletter = enabled.newsletter && (!enabled.discord || slot % 2 === 1);
    const result = await runAccount(context, newsletter);
    if (result.stop) enabled[newsletter ? 'newsletter' : 'discord'] = false;
    if (result.failed) failed = true;
  }
  const completion = await scheduledStep('provider_completion', () =>
    context.exports.ProviderCompletion.run(controller.scheduledTime),
  );
  if (failed || !completion) throw new Error('Scheduled membership work failed');
}
