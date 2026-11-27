import type { DiscordRegionRoleChoices } from '@lasvegasfortransit/platform-core/discord-role-settings';
import { consumeFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import type { StaffContext } from './context';
import { field } from './forms';
import { messageResponse } from './responses';
import { t } from '@lasvegasfortransit/platform-core/messages';
async function call(staff: StaffContext, input: Record<string, unknown>): Promise<Response | null> {
  const discord = staff.accessConfiguration?.discord;
  if (!discord?.configured || !staff.newsletterJobs) return null;
  try {
    return await staff.newsletterJobs.fetch(
      new Request('https://jobs.internal/discord/region-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...input,
          actorId: staff.actor.personId,
          guildId: discord.contextId,
        }),
      }),
    );
  } catch {
    return null;
  }
}
export async function discordRegionChoices(
  staff: StaffContext,
): Promise<DiscordRegionRoleChoices | null> {
  const response = await call(staff, { action: 'list' });
  return response?.ok ? await response.json() : null;
}
export async function submitDiscordRegionSettings(
  request: Request,
  staff: StaffContext,
): Promise<Response> {
  if (request.headers.get('Origin') !== new URL(request.url).origin)
    return messageResponse(t('staff.common.accessDenied'), 403);
  const form = await request.formData(),
    regionId = field(form, 'region_id', 100);
  if (
    !(await consumeFormToken(staff.db, staff.actor, {
      action: `discord:region:${regionId}`,
      token: field(form, 'token', 43),
    }))
  )
    return messageResponse(t('staff.common.reload'), 409);
  const response = await call(staff, {
    action: 'save',
    settings: {
      regionId,
      roleId: field(form, 'role_id', 21) || null,
      expectedVersion: Number(field(form, 'expected_version', 20)),
      operationId: field(form, 'operation_id', 201),
    },
  });
  if (!response) return messageResponse(t('staff.discordRegions.unavailable'), 503);
  if (!response.ok)
    return messageResponse(
      response.status === 403 ? t('staff.common.accessDenied') : t('staff.discordRegions.changed'),
      response.status,
    );
  return new Response(null, {
    status: 303,
    headers: { Location: '/access/discord/regions/?saved=1' },
  });
}
