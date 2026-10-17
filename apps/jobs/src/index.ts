import type { DiscordRuntimeEnv } from '@lasvegasfortransit/platform-integrations/discord-runtime';
import type { BeehiivRuntimeEnv } from '@lasvegasfortransit/platform-integrations/beehiiv-runtime';
import { handleNewsletterEventRequest } from './newsletter-event';
import { handleNewsletterReviewRequest } from './newsletter-review';
import { handleDiscordDisconnectRequest } from './discord-disconnect';
import { handleDiscordJoinRequest } from './discord-join';
import { handleDiscordCommitteeRolesRequest } from './discord-committee-roles';
import { runScheduledMembership } from './scheduled';
export {
  NewsletterAccount,
  NewsletterScan,
  NewsletterIncoming,
  NewsletterPollingChoices,
} from './newsletter';
export { DiscordAccount, DiscordScan, DiscordCommands } from './scheduled-discord';
export {
  StaffMaintenance,
  ProfileMaintenance,
  InactiveProfileMaintenance,
  ProviderCompletion,
} from './scheduled-maintenance';
export default {
  async fetch(request, env) {
    if (request.url === 'https://jobs.internal/discord/committee-roles')
      return await handleDiscordCommitteeRolesRequest(request, env);
    if (request.url === 'https://jobs.internal/newsletter/review')
      return await handleNewsletterReviewRequest(request, env);
    if (request.url === 'https://jobs.internal/newsletter/event')
      return await handleNewsletterEventRequest(request, env);
    return request.url === 'https://jobs.internal/discord/disconnect'
      ? await handleDiscordDisconnectRequest(request, env)
      : await handleDiscordJoinRequest(request, env);
  },
  async scheduled(controller, env, context) {
    await runScheduledMembership(controller, env, context);
  },
} satisfies ExportedHandler<Env & DiscordRuntimeEnv & BeehiivRuntimeEnv>;
