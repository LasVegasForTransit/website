/** Directory observations are accepted only from the configured connector workload. */
export interface DirectoryAccount {
  customerId: string;
  userId: string;
  email: string | null;
  givenName: string | null;
  familyName: string | null;
  orgUnitId: string | null;
  suspended: boolean;
  archived: boolean;
  deleted: boolean;
  observedAt: string;
}
export interface WorkspacePolicy {
  environment: 'production' | 'preview';
  customerId: string;
  humanOrgUnitIds: string[];
  includedUserIds: string[];
  excludedUserIds: string[];
  previewUserIds: string[];
}
export type WorkspaceDisposition = 'active' | 'inactive' | 'review' | 'excluded';
function validAccountEmail(a: Record<string, unknown>): boolean {
  return (
    (a.email === null && a.deleted === true) ||
    (typeof a.email === 'string' &&
      /^[a-z0-9][a-z0-9._+-]*@lasvegasfortransit\.org$/.test(a.email) &&
      a.email.length <= 254)
  );
}
export function directoryAccount(value: unknown, now: Date): DirectoryAccount | null {
  if (!value || typeof value !== 'object') return null;
  const a = value as Record<string, unknown>;
  const nullable = (v: unknown, limit: number) =>
    v === null || (typeof v === 'string' && v.length <= limit);
  if (
    ![a.customerId, a.userId].every((v) => typeof v === 'string' && /^[\w-]{1,128}$/.test(v)) ||
    !nullable(a.givenName, 100) ||
    !nullable(a.familyName, 100) ||
    !nullable(a.orgUnitId, 128) ||
    !['suspended', 'archived', 'deleted'].every((key) => typeof a[key] === 'boolean') ||
    typeof a.observedAt !== 'string' ||
    !Number.isFinite(Date.parse(a.observedAt)) ||
    Date.parse(a.observedAt) > now.getTime() ||
    new Date(a.observedAt).toISOString() !== a.observedAt ||
    !validAccountEmail(a)
  )
    return null;
  return value as DirectoryAccount;
}
export function workspacePolicy(value: unknown): WorkspacePolicy | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (
    !['production', 'preview'].includes(String(p.environment)) ||
    typeof p.customerId !== 'string' ||
    !/^[\w-]{1,128}$/.test(p.customerId) ||
    !['humanOrgUnitIds', 'includedUserIds', 'excludedUserIds', 'previewUserIds'].every(
      (key) =>
        Array.isArray(p[key]) &&
        p[key].length <= 10000 &&
        p[key].every((id: unknown) => typeof id === 'string' && /^[\w:-]{1,128}$/.test(id)),
    )
  )
    return null;
  return value as WorkspacePolicy;
}
export function workspaceDisposition(
  a: DirectoryAccount,
  p: WorkspacePolicy,
  known = false,
): WorkspaceDisposition {
  if (
    a.customerId !== p.customerId ||
    p.excludedUserIds.includes(a.userId) ||
    (p.environment === 'preview' && !p.previewUserIds.includes(a.userId))
  )
    return 'excluded';
  if (a.deleted) return known ? 'inactive' : 'excluded';
  if (!p.includedUserIds.includes(a.userId) && !p.humanOrgUnitIds.includes(a.orgUnitId ?? ''))
    return 'review';
  return a.suspended || a.archived ? 'inactive' : 'active';
}
