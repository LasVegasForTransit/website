/** Public Discord variables that must exist in every staff and jobs Worker. */
export const DISCORD_RUNTIME_CONFIG = [
  {
    name: 'LVBT_DEPLOYMENT_ENV',
    purpose: 'Selects production or isolated preview Discord validation.',
    findValue:
      'Use production for the production Workers and preview for their preview environment.',
  },
  {
    name: 'LVBT_DISCORD_SYNC_ENABLED',
    purpose: 'Enables scheduled Discord work and matching staff role confirmations.',
    findValue:
      'Keep false until maintainer setup is complete. Enable isolated preview for verification, then enable production only after acceptance.',
  },
  {
    name: 'LVBT_DISCORD_APPLICATION_ID',
    purpose: 'Identifies the approved bot application and its shared rate-limit pause.',
    findValue: 'Copy Application ID from the existing LVBT app in the Discord Developer Portal.',
  },
  {
    name: 'LVBT_DISCORD_GUILD_ID',
    purpose: 'Pins the server this deployment may inspect and update.',
    findValue:
      'With Discord Developer Mode enabled, copy the intended server ID. Preview must use a separate test server.',
  },
  {
    name: 'LVBT_DISCORD_PRODUCTION_GUILD_ID',
    purpose: 'Prevents preview work from targeting the production server.',
    findValue:
      'Copy the real LVBT server ID for both environments. It must match the active server only in production.',
  },
  {
    name: 'LVBT_DISCORD_MEMBER_ROLE_ID',
    purpose: 'Identifies the Member role granted only to current LVBT members.',
    findValue:
      'With Discord Developer Mode enabled, copy the intended server Member role ID. It must be below the bot role and cannot be everyone.',
  },
] as const;

/** Secret bindings required by the Workers that serve staff and scheduled jobs. */
export const STAFF_WORKER_BINDINGS = {
  staff: [
    'LVBT_SIGN_IN_SECRET',
    'LVBT_GOOGLE_OAUTH_CLIENT_ID',
    'LVBT_GOOGLE_OAUTH_CLIENT_SECRET',
    'LVBT_RESEND_API_KEY',
    'LVBT_ACCESS_TEAM_DOMAIN',
    'LVBT_ACCESS_AUD',
  ],
  jobs: ['LVBT_DISCORD_BOT_TOKEN'],
} as const;
