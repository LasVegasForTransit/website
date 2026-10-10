import type { MembershipStatus } from './membership';
import type { Interest } from './join-form';

export interface ActorCommittee {
  id: string;
  role: 'member' | 'lead';
  interestIds: readonly Interest[];
}
/** Facts loaded from the current database on every protected request. */
export interface Actor {
  personId: string;
  membershipStatus: MembershipStatus;
  workspaceLinked: boolean;
  staffAdmin: boolean;
  committees: readonly ActorCommittee[];
  eventsLed: readonly string[];
}
export interface PermissionTarget {
  personId?: string;
  committeeId?: string;
  committeeIds?: readonly string[];
  eventId?: string;
  interestIds?: readonly Interest[];
}
export type MutationResult<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'invalid' | 'conflict' | 'not_found' | 'forbidden' | 'last_admin' };

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
