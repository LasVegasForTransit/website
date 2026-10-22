import { runScheduledDiscordWork } from './scheduled-discord-work';
import { membershipStep, canContinueMembership, type ScheduledBudget } from './scheduled-budget';
import { runScheduledTaskCheckins } from './scheduled-task-checkins';
import { withScheduledAdmission, type ScheduledAdmission } from './scheduled-admission';
import { runDueMaintenance } from './scheduled-privacy';
import {
  acknowledgeScheduledSignal,
  nextProviderWork,
  readyProviderScans,
  readyProviderQueues,
  outboxSelectionHasMore,
} from '@lasvegasfortransit/platform-storage/scheduled-wake';

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
  // Keep roster writes within the shared reservation alongside incoming choices and removals.
  for (let page = 0; page < 3 && enabled.newsletter && canContinueMembership(budget); page++) {
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
    if (result.more) budget.more = true;
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
    stop: (!result?.selected && !result?.more) || result.paused || result.failed,
    failed: !result || result.failed,
  };
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

async function processDueInputs(
  now: Date,
  context: ExecutionContext,
  admission: ScheduledAdmission,
) {
  const { db, budget, providers } = admission;
  // Incoming withdrawals already eligible at dispatch must precede outgoing work.
  const ready = await readyProviderScans(
    db,
    new Date(Math.max(now.getTime(), Date.now())),
    providers,
  );
  const commandFailed = await registerDiscordCommand(
    context,
    Boolean(providers.guildId && ready.command),
    budget,
  );
  const incomingFailed =
    providers.publicationId && ready.incoming ? await processIncoming(context, budget) : false;
  const scans = {
    discord: Boolean(providers.guildId && ready.discord),
    newsletter: Boolean(providers.publicationId && ready.newsletter),
  };
  const scanFailed = await scanProviders(context, scans, budget);
  // Scans save choices after the cron timestamp within this invocation.
  const queues = await readyProviderQueues(
    db,
    new Date(Math.max(now.getTime(), Date.now())),
    providers,
  );
  const choiceFailed =
    providers.publicationId && queues.choices
      ? await processIncoming(context, budget, true)
      : false;
  return {
    failed: [commandFailed, incomingFailed, scanFailed, choiceFailed].some(Boolean),
    newsletterPaused: ready.newsletter && !scans.newsletter,
  };
}
function outgoingProviders(
  providers: ScheduledAdmission['providers'],
  queues: Awaited<ReturnType<typeof readyProviderQueues>>,
  paused: boolean,
) {
  return {
    discord: Boolean(providers.guildId && queues.outbox && !queues.discordPaused),
    newsletter: Boolean(
      providers.publicationId && queues.newsletter && !paused && !queues.newsletterPaused,
    ),
  };
}
async function advanceTaskCheckins(
  context: ExecutionContext,
  enabled: EnabledProviders,
  budget: ScheduledBudget,
) {
  let failed = false;
  for (const provider of ['discord', 'newsletter'] as const) {
    if (!enabled[provider] || !canContinueMembership(budget)) continue;
    const result = await runAccount(context, provider === 'newsletter', budget);
    if (result.stop) enabled[provider] = false;
    failed ||= result.failed;
  }
  return (await runScheduledTaskCheckins(context, budget)) || failed;
}
async function advanceSharedWork(
  context: ExecutionContext,
  admission: ScheduledAdmission,
  failed: boolean,
): Promise<boolean> {
  if (!admission.discordWork) return failed;
  return (await runScheduledDiscordWork(context, admission.budget)) || failed;
}
async function processDueAccounts(
  now: Date,
  context: ExecutionContext,
  admission: ScheduledAdmission,
  paused: boolean,
) {
  const { db, budget, providers } = admission;
  // Scans can enqueue work after the cron timestamp within this invocation.
  const queues = await readyProviderQueues(
    db,
    new Date(Math.max(now.getTime(), Date.now())),
    providers,
  );
  const enabled = outgoingProviders(providers, queues, paused);
  let failed = false;
  if (admission.taskCheckins) failed = await advanceTaskCheckins(context, enabled, budget);
  failed = await advanceSharedWork(context, admission, failed);
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
  if (queues.outbox) {
    await membershipStep(budget, 'provider_completion', () =>
      context.exports.ProviderCompletion.run(now.getTime()),
    );
    budget.more ||= await outboxSelectionHasMore(db, 'completion');
  }
  return { failed, more: enabled.discord || enabled.newsletter || budget.more === true };
}
async function runAdmittedMembership(
  controller: ScheduledController,
  context: ExecutionContext,
  admission: ScheduledAdmission,
) {
  const now = new Date(controller.scheduledTime);
  await runDueMaintenance(now, context, admission);
  const signal = admission.signals.find((item) => item.name === 'providers');
  if (!signal) return;
  const inputs = await processDueInputs(now, context, admission);
  const accounts = await processDueAccounts(
    now,
    context,
    admission,
    Boolean(inputs.newsletterPaused),
  );
  if (inputs.failed || accounts.failed) throw new Error('Scheduled membership work failed');
  const next = await nextProviderWork(
    admission.db,
    now,
    admission.providers,
    accounts.more || admission.taskCheckins || Boolean(admission.discordWork),
  );
  await acknowledgeScheduledSignal(admission.db, signal, admission.configuration, next);
}
export async function runScheduledMembership(
  controller: ScheduledController,
  env: Env,
  context: ExecutionContext,
): Promise<void> {
  await withScheduledAdmission(controller, env, (admission) =>
    runAdmittedMembership(controller, context, admission),
  );
}
