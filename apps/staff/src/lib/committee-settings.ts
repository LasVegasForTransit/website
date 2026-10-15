import {
  updateCommitteeSettings,
  normalizeSettings,
  type CommitteeSettingsInput,
} from '@lasvegasfortransit/platform-storage/committee-settings';
import {
  getCommitteeView,
  type CommitteeSettings,
} from '@lasvegasfortransit/platform-storage/committee-views';
import { saveDiscordCommitteeSettings } from './discord-role-settings';
import { consumeFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import type { Interest } from '@lasvegasfortransit/platform-core/join-form';
import type { StaffContext } from './context';
import { field } from './forms';
import { messageResponse } from './responses';
export const INTEREST_LABELS = {
  events: 'Events',
  meetings: 'Meetings',
  volunteering: 'Volunteering',
  news: 'News and updates',
};
export interface SettingsFeedback {
  input: CommitteeSettingsInput;
  message: string;
  status: number;
}
function settingsInput(form: FormData, current: CommitteeSettings): CommitteeSettingsInput {
  return {
    description: field(form, 'description', 2001),
    timeCommitment: field(form, 'time_commitment', 151),
    acceptingMembers: field(form, 'accepting_members', 10) === 'yes',
    workspaceGroupEmail: field(form, 'workspace_group_email', 255) || null,
    discordRoleId: form.has('discord_role_id')
      ? field(form, 'discord_role_id', 21) || null
      : current.discordRoleId,
    discordLeadRoleId: form.has('discord_lead_role_id')
      ? field(form, 'discord_lead_role_id', 21) || null
      : current.discordLeadRoleId,
    interestIds: form.getAll('interests') as Interest[],
    expectedVersion: Number(field(form, 'expected_version', 20)),
    operationId: field(form, 'operation_id', 201),
  };
}
function connectionsChanged(input: CommitteeSettingsInput, current: CommitteeSettings): boolean {
  return (
    input.discordRoleId !== current.discordRoleId ||
    input.discordLeadRoleId !== current.discordLeadRoleId
  );
}
export async function submitSettings(
  request: Request,
  staff: StaffContext,
  committeeId: string,
): Promise<Response | SettingsFeedback> {
  const form = await request.formData();
  if (
    !(await consumeFormToken(staff.db, staff.actor, {
      action: `committee:settings:${committeeId}`,
      token: field(form, 'token', 43),
    }))
  )
    return messageResponse(
      'This form expired or was already submitted. Reload the committee and try again.',
      409,
    );
  const current = (await getCommitteeView(staff.db, staff.actor, committeeId))?.committee;
  if (!current) return messageResponse("You don't have access to this", 403);
  const accepting = field(form, 'accepting_members', 10);
  const input = settingsInput(form, current);
  const invalid = {
    input,
    status: 400,
    message:
      'Check the committee details, choose the welcome interests from the list, and use an LVBT group email.',
  };
  if (!['yes', 'no'].includes(accepting) || !normalizeSettings(input)) return invalid;
  const rolesChanged = connectionsChanged(input, current);
  const result = rolesChanged
    ? await saveDiscordCommitteeSettings(staff, committeeId, input)
    : await updateCommitteeSettings(staff.db, staff.actor, committeeId, input);
  if (result.kind === 'invalid_role' || result.kind === 'unavailable')
    return {
      input,
      status: result.kind === 'invalid_role' ? 400 : 503,
      message:
        result.kind === 'invalid_role'
          ? 'One of the Discord choices is no longer available. Choose from the current list and save again.'
          : 'Discord connections are unavailable. Try again later; your changes have not been saved.',
    };
  if (result.kind === 'ok')
    return new Response(null, {
      status: 303,
      headers: { Location: `/committees/${committeeId}/` },
    });
  if (result.kind === 'forbidden' || result.kind === 'not_found')
    return messageResponse("You don't have access to this", 403);
  return result.kind === 'invalid'
    ? invalid
    : {
        input,
        status: 409,
        message:
          'The committee changed, or an account connection belongs to another committee. Reload the committee before saving.',
      };
}
