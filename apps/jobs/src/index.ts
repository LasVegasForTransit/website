import {
  discordRuntime,
  type DiscordRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/discord-runtime';
import { reconcileDiscordPending } from '@lasvegasfortransit/platform-integrations/discord-runner';
import { runMaintenance } from '@lasvegasfortransit/platform-storage/retention';
import { queueDiscordDrift } from '@lasvegasfortransit/platform-storage/discord-drift';
import { completeProviderOperations } from '@lasvegasfortransit/platform-storage/provider-completion';
export default {
  fetch() {
    return new Response('Not found', { status: 404 });
  },
  async scheduled(controller, env) {
    try {
      const maintenance = await runMaintenance(env.PLATFORM_DB, {
        now: new Date(controller.scheduledTime),
      });
      console.log(JSON.stringify({ event: 'staff_maintenance', ...maintenance }));
    } catch {
      throw new Error('Scheduled staff maintenance failed');
    }
    const runtime = discordRuntime(env);
    if (!runtime) {
      let completed: number;
      try {
        completed = await completeProviderOperations(env.PLATFORM_DB, {
          now: new Date(controller.scheduledTime),
        });
      } catch {
        throw new Error('Scheduled provider completion failed');
      }
      console.log(
        JSON.stringify({
          event: 'discord_reconcile',
          ready: false,
          cron: controller.cron,
          completed,
        }),
      );
      return;
    }
    try {
      const drift = await queueDiscordDrift(env.PLATFORM_DB, {
        guildId: runtime.configuration.guildId,
      });
      const counts = await reconcileDiscordPending(env.PLATFORM_DB, runtime);
      const completed = await completeProviderOperations(env.PLATFORM_DB, {
        now: new Date(controller.scheduledTime),
      });
      console.log(
        JSON.stringify({
          event: 'discord_reconcile',
          ready: true,
          cron: controller.cron,
          drift,
          ...counts,
          completed,
        }),
      );
    } catch {
      throw new Error('Scheduled Discord reconciliation failed');
    }
  },
} satisfies ExportedHandler<Env & DiscordRuntimeEnv>;
