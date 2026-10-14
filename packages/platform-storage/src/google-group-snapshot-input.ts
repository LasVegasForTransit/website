import { digestToken } from '@lasvegasfortransit/platform-core/random-token';

export interface GoogleSnapshotMember {
  id: string;
  type: 'USER' | 'GROUP' | 'CUSTOMER' | 'EXTERNAL';
  role: 'MEMBER' | 'MANAGER' | 'OWNER';
}
export interface GoogleSnapshot {
  customerId: string;
  groupEmail: string;
  groupId: string;
  startedAt: string;
  observedAt: string;
  members: GoogleSnapshotMember[];
  userCount: number | null;
  hash: string;
  expiresAt: string;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid Google group snapshot');
  return value as Record<string, unknown>;
}
export function googleGroupKey(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
export function googleGroupEmail(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 254 &&
    /^[a-z0-9][a-z0-9._+-]*@lasvegasfortransit\.org$/.test(value)
  );
}
export function googleCheckDate(value: unknown, now: Date): value is string {
  if (typeof value !== 'string') return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= now.getTime() && new Date(time).toISOString() === value;
}
function member(value: unknown): GoogleSnapshotMember {
  const row = record(value);
  if (
    !googleGroupKey(row.id) ||
    typeof row.type !== 'string' ||
    !['USER', 'GROUP', 'CUSTOMER', 'EXTERNAL'].includes(row.type) ||
    typeof row.role !== 'string' ||
    !['MEMBER', 'MANAGER', 'OWNER'].includes(row.role)
  )
    throw new Error('Invalid Google group snapshot member');
  return {
    id: row.id,
    type: row.type as GoogleSnapshotMember['type'],
    role: row.role as GoogleSnapshotMember['role'],
  };
}
export async function parseGoogleSnapshot(value: unknown, now: Date): Promise<GoogleSnapshot> {
  const row = record(value);
  if (
    !googleGroupKey(row.customerId) ||
    row.customerId === 'my_customer' ||
    !googleGroupKey(row.groupId) ||
    !googleGroupEmail(row.groupEmail) ||
    !googleCheckDate(row.startedAt, now) ||
    !googleCheckDate(row.observedAt, now) ||
    row.startedAt > row.observedAt ||
    !Array.isArray(row.members) ||
    row.members.length > 10000
  )
    throw new Error('Invalid Google group snapshot');
  const members = row.members.map(member).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(members.map((entry) => entry.id)).size !== members.length)
    throw new Error('Duplicate Google group snapshot member');
  return {
    customerId: row.customerId,
    groupId: row.groupId,
    groupEmail: row.groupEmail,
    startedAt: row.startedAt,
    observedAt: row.observedAt,
    members,
    userCount: members.some((entry) => entry.type === 'CUSTOMER' || entry.type === 'EXTERNAL')
      ? null
      : members.filter((entry) => entry.type === 'USER').length,
    hash: await digestToken(JSON.stringify(members)),
    expiresAt: new Date(Date.parse(row.observedAt) + 300000).toISOString(),
  };
}
