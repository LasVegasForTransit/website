import type { GoogleGroups } from './google-groups';
import { checkGoogleGroupCurrent } from './google-group-current';
import {
  GoogleGroupsFailure,
  type GoogleGroupInventoryMember,
  type GoogleGroupListInput,
  type GoogleGroupMembersPage,
} from './google-groups-types';

export interface GoogleGroupInventory extends Omit<GoogleGroupMembersPage, 'nextPageToken'> {
  userCount: number | null;
  startedAt: string;
}

function addMembers(
  members: Map<string, GoogleGroupInventoryMember>,
  page: GoogleGroupMembersPage,
): void {
  for (const member of page.members) {
    const previous = members.get(member.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(member))
      throw new GoogleGroupsFailure('invalid_response');
    members.set(member.id, member);
  }
}

function countUsers(members: GoogleGroupInventoryMember[]): number | null {
  if (members.some((member) => member.type === 'CUSTOMER' || member.type === 'EXTERNAL'))
    return null;
  return members.filter((member) => member.type === 'USER').length;
}

async function completeInventory(
  input: Pick<GoogleGroupListInput, 'isCurrent'>,
  page: GoogleGroupMembersPage,
  members: Map<string, GoogleGroupInventoryMember>,
  clock: { started: number; now: () => number },
): Promise<GoogleGroupInventory> {
  await checkGoogleGroupCurrent(input, clock.started + 30000, clock.now);
  const complete = [...members.values()];
  return {
    customerId: page.customerId,
    groupId: page.groupId,
    groupEmail: page.groupEmail,
    members: complete,
    userCount: countUsers(complete),
    startedAt: new Date(clock.started).toISOString(),
    observedAt: page.observedAt,
  };
}

/** A failure discards all partial pages. Call from provider work, never a page render. */
export async function readGoogleGroupInventory(
  client: GoogleGroups,
  input: Pick<GoogleGroupListInput, 'groupEmail' | 'isCurrent'>,
  options: { now?: () => number } = {},
): Promise<GoogleGroupInventory> {
  const now = options.now ?? Date.now;
  const request = { ...input };
  const started = now();
  if (!Number.isFinite(started)) throw new GoogleGroupsFailure('not_configured');
  const deadline = started + 30000;
  const members = new Map<string, GoogleGroupInventoryMember>();
  const cursors = new Set<string>();
  let pageToken: string | undefined;
  let expectedGroupId: string | undefined;
  for (let pageNumber = 0; pageNumber < 50; pageNumber += 1) {
    if (now() >= deadline) throw new GoogleGroupsFailure('provider_unavailable');
    const page = await client.listMembers({
      ...request,
      deadline,
      ...(pageToken === undefined ? {} : { pageToken }),
      ...(expectedGroupId === undefined ? {} : { expectedGroupId }),
    });
    expectedGroupId = page.groupId;
    addMembers(members, page);
    if (page.nextPageToken === null)
      return await completeInventory(request, page, members, { started, now });
    if (cursors.has(page.nextPageToken)) throw new GoogleGroupsFailure('invalid_response');
    cursors.add(page.nextPageToken);
    pageToken = page.nextPageToken;
  }
  throw new GoogleGroupsFailure('invalid_response');
}
