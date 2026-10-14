import {
  discordRuntime,
  type DiscordRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/discord-runtime';
import { reconcileDiscordPending } from '@lasvegasfortransit/platform-integrations/discord-runner';
import { DiscordAccess } from '@lasvegasfortransit/platform-integrations/discord-access';
import { discordRateLimit } from '@lasvegasfortransit/platform-integrations/discord-rate-limit';
import { runMaintenance } from '@lasvegasfortransit/platform-storage/retention';
import { queueDiscordDrift } from '@lasvegasfortransit/platform-storage/discord-drift';
import { scanDiscordGuildRoster } from '@lasvegasfortransit/platform-integrations/discord-roster';
import { completeProviderOperations } from '@lasvegasfortransit/platform-storage/provider-completion';
import { handleDiscordJoinRequest } from './discord-join';
export default {
  async fetch(request, env) {
    return await handleDiscordJoinRequest(request, env);
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
      const rosterClient = new DiscordAccess(runtime.configuration, {
        rateLimit: discordRateLimit(env.PLATFORM_DB, runtime.applicationId),
      });
      const roster = await scanDiscordGuildRoster(env.PLATFORM_DB, {
        client: rosterClient,
        memberRoleId: runtime.memberRoleId,
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
          roster,
          ...counts,
          completed,
        }),
      );
    } catch {
      throw new Error('Scheduled Discord reconciliation failed');
    }
  },
} satisfies ExportedHandler<Env & DiscordRuntimeEnv>;
