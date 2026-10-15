import { INTERESTS, type Interest } from '@lasvegasfortransit/platform-core/join-form';
export interface CommitteeSettingsInput {
  description: string;
  timeCommitment: string;
  acceptingMembers: boolean;
  workspaceGroupEmail: string | null;
  discordRoleId: string | null;
  discordLeadRoleId?: string | null;
  interestIds: Interest[];
  expectedVersion: number;
  operationId: string;
}
function hasSettingsShape(input: CommitteeSettingsInput): boolean {
  return (
    [input.description, input.timeCommitment, input.operationId].every(
      (value) => typeof value === 'string',
    ) &&
    [input.workspaceGroupEmail, input.discordRoleId].every(
      (value) => value === null || typeof value === 'string',
    ) &&
    (input.discordLeadRoleId === undefined ||
      input.discordLeadRoleId === null ||
      typeof input.discordLeadRoleId === 'string') &&
    typeof input.acceptingMembers === 'boolean' &&
    Array.isArray(input.interestIds)
  );
}
function withinLimits(input: CommitteeSettingsInput): boolean {
  return (
    input.description.length <= 2000 &&
    input.timeCommitment.length <= 150 &&
    Number.isSafeInteger(input.expectedVersion) &&
    input.expectedVersion >= 1 &&
    input.operationId.trim().length > 0 &&
    input.operationId.length <= 200
  );
}
function validGroup(email: string | null): boolean {
  return (
    !email || (email.length <= 254 && /^[a-z0-9][a-z0-9._+-]*@lasvegasfortransit\.org$/.test(email))
  );
}
function validRole(id: string | null): boolean {
  return !id || (/^[1-9][0-9]{0,19}$/.test(id) && BigInt(id) <= 18_446_744_073_709_551_615n);
}
function nullableText(value: string | null | undefined): string | null {
  const text = value?.trim() ?? '';
  return text === '' ? null : text;
}
function validConnections(input: CommitteeSettingsInput): boolean {
  return (
    validGroup(input.workspaceGroupEmail) &&
    validRole(input.discordRoleId) &&
    validRole(input.discordLeadRoleId ?? null) &&
    (input.discordRoleId === null || input.discordRoleId !== input.discordLeadRoleId)
  );
}
export function normalizeSettings(input: CommitteeSettingsInput): CommitteeSettingsInput | null {
  if (!hasSettingsShape(input) || !withinLimits(input)) return null;
  const workspaceGroupEmail = nullableText(input.workspaceGroupEmail)?.toLowerCase() ?? null;
  const discordRoleId = nullableText(input.discordRoleId);
  const discordLeadRoleId = nullableText(input.discordLeadRoleId);
  if (!validConnections({ ...input, workspaceGroupEmail, discordRoleId, discordLeadRoleId }))
    return null;
  if (input.interestIds.some((id) => !INTERESTS.some((interest) => interest === id))) return null;
  return {
    ...input,
    description: input.description.trim(),
    timeCommitment: input.timeCommitment.trim(),
    workspaceGroupEmail,
    discordRoleId,
    discordLeadRoleId,
    interestIds: [...new Set(input.interestIds)].sort(),
  };
}
