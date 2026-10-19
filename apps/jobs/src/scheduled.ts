import {
  SCHEDULED_CONTROL_ALLOWANCE,
  reserveScheduledWork,
  settleScheduledWork,
  isD1QuotaExceeded,
} from '@lasvegasfortransit/platform-storage/query-budget';
import {
  beehiivRuntime,
  type BeehiivRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/beehiiv-runtime';
import {
  discordRuntime,
  type DiscordRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/discord-runtime';
import {
  membershipStep,
  canContinueMembership,
  type ScheduledBudget,
  emptyScheduledUsage,
  ScheduledWorkDeferred,
} from './scheduled-budget';
import { memberPrivacySchedule } from '@lasvegasfortransit/platform-storage/member-privacy-schedule';

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
  polled = false,
): Promise<boolean> {
  for (let batch = 0; batch < 6 && canContinueMembership(budget); batch++) {
    const result = await membershipStep(
      budget,
      polled ? 'newsletter_poll_choices' : 'newsletter_incoming',
      async () =>
        polled
          ? await context.exports.NewsletterPollingChoices.run()
          : await context.exports.NewsletterIncoming.run(),
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
      scanAllowed: Boolean(result && !result.paused && result.kind !== 'failed'),
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
    scanAllowed: Boolean(result && !result.paused && !result.failed),
  };
}

async function processProviderQueues(
  context: ExecutionContext,
  enabled: EnabledProviders,
  budget: ScheduledBudget,
) {
  const incomingFailed = enabled.newsletter ? await processIncoming(context, budget) : false;
  const newsletterReady = enabled.newsletter;
  // Scans still run for idle queues; their new work can wait for the next minute tick.
  const scans = { ...enabled };
  // Current removals and member choices run before optional roster scans.
  let priorityFailed = false;
  if (enabled.discord && canContinueMembership(budget)) {
    const result = await runAccount(context, false, budget);
    priorityFailed = result.failed;
    enabled.discord = !result.stop;
    scans.discord = result.scanAllowed;
  }
  if (enabled.newsletter && canContinueMembership(budget)) {
    const result = await runAccount(context, true, budget);
    priorityFailed ||= result.failed;
    enabled.newsletter = !result.stop;
    scans.newsletter = result.scanAllowed;
  }
  const scanFailed = await scanProviders(context, scans, budget);
  enabled.discord &&= scans.discord;
  enabled.newsletter &&= scans.newsletter;
  const pollingFailed = newsletterReady ? await processIncoming(context, budget, true) : false;
  return [incomingFailed, scanFailed, pollingFailed, priorityFailed].some(Boolean);
}
async function registerDiscordCommand(
  context: ExecutionContext,
  enabled: boolean,
  budget: ScheduledBudget,
): Promise<boolean> {
  if (!enabled || !canContinueMembership(budget)) return false;
  const result = await membershipStep(budget, 'discord_commands', () =>
    context.exports.DiscordCommands.run(),
  );
  return !result || result.kind === 'failed';
}
async function runAdmittedMembership(
  controller: ScheduledController,
  env: Env & BeehiivRuntimeEnv & DiscordRuntimeEnv,
  context: ExecutionContext,
  budget: ScheduledBudget,
): Promise<void> {
  // The scheduled parent is one of the 32 invocations; completion always gets a reserved call.
  const records =
    new Date(controller.scheduledTime).getUTCMinutes() === 0
      ? await membershipStep(budget, 'staff_maintenance', () =>
          context.exports.StaffMaintenance.run(controller.scheduledTime),
        )
      : true;
  const profiles = await membershipStep(budget, 'profile_maintenance', () =>
    context.exports.ProfileMaintenance.run(controller.scheduledTime),
  );
  const inactive = memberPrivacySchedule(new Date(controller.scheduledTime))
    ? await membershipStep(budget, 'inactive_profile_maintenance', () =>
        context.exports.InactiveProfileMaintenance.run(controller.scheduledTime),
      )
    : true;
  const enabled = {
    discord: Boolean(discordRuntime(env)),
    newsletter: Boolean(beehiivRuntime(env)),
  };
  const commandFailed = await registerDiscordCommand(context, enabled.discord, budget);
  const queueFailed = await processProviderQueues(context, enabled, budget);
  let failed = [commandFailed, queueFailed, !records, !profiles, !inactive].some(Boolean);
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

export async function runScheduledMembership(
  controller: ScheduledController,
  env: Env & BeehiivRuntimeEnv & DiscordRuntimeEnv,
  context: ExecutionContext,
): Promise<void> {
  let lease;
  try {
    lease = await reserveScheduledWork(
      env.PLATFORM_DB,
      env.LVBT_DEPLOYMENT_ENV,
      new Date(),
      crypto.randomUUID(),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        event: 'scheduled_work_deferred',
        reason: isD1QuotaExceeded(error) ? 'account_quota' : 'guard_unavailable',
      }),
    );
    return;
  }
  if (!lease) {
    console.log(
      JSON.stringify({ event: 'scheduled_work_deferred', reason: 'budget_closed_or_leased' }),
    );
    return;
  }
  const budget = {
    remaining: 31,
    deadline: Date.now() + 50_000,
    usage: emptyScheduledUsage(),
    controlReads: lease.guardReads + SCHEDULED_CONTROL_ALLOWANCE.reads,
    controlWrites: lease.guardWrites + SCHEDULED_CONTROL_ALLOWANCE.writes,
  };
  let failed = lease.metadataMissing > 0;
  let failure: Error | undefined;
  try {
    if (failed) throw new ScheduledWorkDeferred();
    await runAdmittedMembership(controller, env, context, budget);
  } catch (error) {
    failed = true;
    failure = error instanceof Error ? error : new ScheduledWorkDeferred();
    budget.usage.quota_exhausted ||= isD1QuotaExceeded(error);
    console.log(
      JSON.stringify({
        event: 'scheduled_work_deferred',
        reason: budget.usage.quota_exhausted ? 'account_quota' : 'unverified_or_spent_budget',
      }),
    );
  } finally {
    try {
      await settleScheduledWork(env.PLATFORM_DB, lease, budget.usage, { failed, now: new Date() });
    } catch {
      console.log(
        JSON.stringify({ event: 'scheduled_work_deferred', reason: 'settlement_unavailable' }),
      );
      failure ??= new ScheduledWorkDeferred();
    }
  }
  if (failure) throw failure;
}
