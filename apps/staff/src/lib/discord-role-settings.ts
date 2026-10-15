import type { DiscordCommitteeRoleChoices } from '@lasvegasfortransit/platform-core/discord-role-settings';
import type { MutationResult } from '@lasvegasfortransit/platform-core/staff-types';
import type { CommitteeSettingsInput } from '@lasvegasfortransit/platform-storage/committee-settings';
import type { CommitteeSettings } from '@lasvegasfortransit/platform-storage/committee-views';
import type { StaffContext } from './context';
export type DiscordSettingsResult =
  MutationResult<CommitteeSettings> | { kind: 'invalid_role' | 'unavailable' };
async function call(staff: StaffContext, committeeId: string, input: Record<string, unknown>) {
  const discord = staff.accessConfiguration?.discord;
  if (!discord?.configured || !staff.newsletterJobs) return null;
  try {
    return await staff.newsletterJobs.fetch(
      new Request('https://jobs.internal/discord/committee-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...input,
          actorId: staff.actor.personId,
          committeeId,
          guildId: discord.contextId,
        }),
      }),
    );
  } catch {
    return null;
  }
}
export async function discordCommitteeChoices(
  staff: StaffContext,
  committeeId: string,
): Promise<DiscordCommitteeRoleChoices | null> {
  const response = await call(staff, committeeId, { action: 'list' });
  return response?.ok ? await response.json() : null;
}
export async function saveDiscordCommitteeSettings(
  staff: StaffContext,
  committeeId: string,
  settings: CommitteeSettingsInput,
): Promise<DiscordSettingsResult> {
  const response = await call(staff, committeeId, { action: 'save', settings });
  return response && response.status < 500 ? await response.json() : { kind: 'unavailable' };
}
