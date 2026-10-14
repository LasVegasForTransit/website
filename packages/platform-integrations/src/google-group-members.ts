import type { GoogleGroupsHttp } from './google-groups-http';
import { checkGoogleGroupCurrent } from './google-group-current';
import {
  GoogleGroupsFailure,
  record,
  stableId,
  type GoogleGroupListInput,
  type GoogleGroupInventoryMember,
  type GoogleGroupMembersPage,
} from './google-groups-types';

export function validGooglePageToken(value: unknown): value is string {
  return typeof value === 'string' && /^[\x21-\x7e]{1,4096}$/.test(value);
}

function member(value: unknown): GoogleGroupInventoryMember {
  const row = record(value);
  if (
    !stableId(row.id) ||
    typeof row.type !== 'string' ||
    !['USER', 'GROUP', 'CUSTOMER', 'EXTERNAL'].includes(row.type) ||
    typeof row.role !== 'string' ||
    !['MEMBER', 'MANAGER', 'OWNER'].includes(row.role) ||
    (row.email !== undefined &&
      (typeof row.email !== 'string' ||
        row.email.length > 254 ||
        !/^[^@\s]+@[^@\s]+$/.test(row.email))) ||
    (row.status !== undefined &&
      (typeof row.status !== 'string' || !/^[A-Z_]{1,32}$/.test(row.status)))
  )
    throw new GoogleGroupsFailure('invalid_response');
  return {
    id: row.id,
    type: row.type as GoogleGroupInventoryMember['type'],
    role: row.role as GoogleGroupInventoryMember['role'],
    email: typeof row.email === 'string' ? row.email : null,
    status: typeof row.status === 'string' ? row.status : null,
  };
}

function validateInput(input: GoogleGroupListInput): void {
  if (
    (input.pageToken !== undefined &&
      (!validGooglePageToken(input.pageToken) || input.expectedGroupId === undefined)) ||
    (input.expectedGroupId !== undefined && !stableId(input.expectedGroupId)) ||
    (input.deadline !== undefined && !Number.isFinite(input.deadline))
  )
    throw new GoogleGroupsFailure('not_configured');
}

async function groupId(
  http: GoogleGroupsHttp,
  input: GoogleGroupListInput,
  deadline: number,
): Promise<string> {
  const group = record(
    await http.request(`/groups/${encodeURIComponent(input.groupEmail)}`, {}, deadline),
  );
  if (
    !stableId(group.id) ||
    group.email !== input.groupEmail ||
    (input.expectedGroupId !== undefined && group.id !== input.expectedGroupId)
  )
    throw new GoogleGroupsFailure('invalid_response');
  return group.id;
}

function pageMembers(value: unknown) {
  const data = record(value);
  if (
    data.kind !== 'admin#directory#members' ||
    (data.members !== undefined && (!Array.isArray(data.members) || data.members.length > 200)) ||
    (data.nextPageToken !== undefined && !validGooglePageToken(data.nextPageToken))
  )
    throw new GoogleGroupsFailure('invalid_response');
  return {
    members: (Array.isArray(data.members) ? data.members : []).map(member),
    nextPageToken: typeof data.nextPageToken === 'string' ? data.nextPageToken : null,
  };
}

/** Read a registered group page, including indirect membership, without changing access. */
export async function readGoogleGroupPage(
  http: GoogleGroupsHttp,
  customerId: string,
  input: GoogleGroupListInput,
): Promise<GoogleGroupMembersPage> {
  validateInput(input);
  const deadline = Math.min(input.deadline ?? Infinity, http.now() + 30000);
  await checkGoogleGroupCurrent(input, deadline, http.now);
  const id = await groupId(http, input, deadline);
  await checkGoogleGroupCurrent(input, deadline, http.now);
  const params = new URLSearchParams({ includeDerivedMembership: 'true', maxResults: '200' });
  if (input.pageToken !== undefined) params.set('pageToken', input.pageToken);
  const page = pageMembers(
    await http.request(
      `/groups/${encodeURIComponent(id)}/members?${params.toString()}`,
      {},
      deadline,
    ),
  );
  await checkGoogleGroupCurrent(input, deadline, http.now);
  await groupId(http, { ...input, expectedGroupId: id }, deadline);
  await checkGoogleGroupCurrent(input, deadline, http.now);
  return {
    customerId,
    groupId: id,
    groupEmail: input.groupEmail,
    ...page,
    observedAt: new Date(http.now()).toISOString(),
  };
}
