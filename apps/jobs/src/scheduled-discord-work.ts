import { membershipStep, canContinueMembership, type ScheduledBudget } from './scheduled-budget';
export async function runScheduledDiscordWork(
  context: ExecutionContext,
  budget: ScheduledBudget,
): Promise<boolean> {
  const steps = [
    ['discord_work_commands', () => context.exports.DiscordWorkCommands.run()],
    ['discord_work_ingest', () => context.exports.DiscordWorkIngest.run()],
    ['discord_work_effects', () => context.exports.DiscordWorkEffects.run()],
    ['discord_work_refresh', () => context.exports.DiscordWorkRefresh.run()],
  ] as const;
  let failed = false;
  for (const [event, run] of steps) {
    if (!canContinueMembership(budget)) break;
    const result = await membershipStep<{ kind: string }>(budget, event, run);
    if (!result || result.kind === 'failed') failed = true;
  }
  return failed;
}
