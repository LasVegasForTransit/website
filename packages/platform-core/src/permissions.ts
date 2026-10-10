import type { Actor, PermissionTarget } from './staff-types';
export type Permission =
  | 'self.view'
  | 'self.update'
  | 'self.export'
  | 'self.delete'
  | 'access.view'
  | 'access.recover'
  | 'console.enter'
  | 'person.view'
  | 'person.search'
  | 'person.update'
  | 'review_queue.resolve'
  | 'person.merge'
  | 'person.unmerge'
  | 'committee.assign'
  | 'committee.view'
  | 'committee.settings'
  | 'attendance.record'
  | 'attendance.view_event'
  | 'donations.view'
  | 'export.full'
  | 'announcement.send'
  | 'staff_admin.manage'
  | 'welcome.view'
  | 'welcome.claim'
  | 'welcome.complete';

type Scope =
  'self' | 'staff' | 'person' | 'committee' | 'volunteer' | 'event' | 'admin' | 'welcome';
export const PERMISSION_SCOPES: Record<Permission, Scope> = {
  'self.view': 'self',
  'self.update': 'self',
  'self.export': 'self',
  'self.delete': 'self',
  'console.enter': 'staff',
  'access.view': 'staff',
  'access.recover': 'admin',
  'person.view': 'person',
  'person.search': 'person',
  'person.update': 'admin',
  'review_queue.resolve': 'admin',
  'person.merge': 'admin',
  'person.unmerge': 'admin',
  'committee.assign': 'committee',
  'committee.view': 'committee',
  'committee.settings': 'admin',
  'attendance.record': 'volunteer',
  'attendance.view_event': 'event',
  'donations.view': 'admin',
  'export.full': 'admin',
  'announcement.send': 'committee',
  'staff_admin.manage': 'admin',
  'welcome.view': 'welcome',
  'welcome.claim': 'welcome',
  'welcome.complete': 'welcome',
};
export const ACCESS_DENIED = "You don't have access to this";

export function leadCommitteeIds(actor: Actor): string[] {
  return actor.committees
    .filter((committee) => committee.role === 'lead')
    .map((committee) => committee.id);
}
function welcomeScope(actor: Actor, target?: PermissionTarget): boolean {
  const interests = actor.committees
    .filter((committee) => committee.role === 'lead')
    .flatMap((committee) => committee.interestIds);
  return target
    ? Boolean(target.interestIds?.some((interest) => interests.includes(interest)))
    : interests.length > 0;
}
function personScope(actor: Actor, permission: Permission, target?: PermissionTarget): boolean {
  const committees = leadCommitteeIds(actor);
  return target
    ? Boolean(target.committeeIds?.some((id) => committees.includes(id)))
    : permission === 'person.search' && committees.length > 0;
}
function committeeScope(actor: Actor, target?: PermissionTarget): boolean {
  return Boolean(target?.committeeId && leadCommitteeIds(actor).includes(target.committeeId));
}
function eventScope(actor: Actor, target?: PermissionTarget): boolean {
  return Boolean(
    target?.eventId &&
    leadCommitteeIds(actor).length > 0 &&
    actor.eventsLed.includes(target.eventId),
  );
}
export function can(actor: Actor, permission: Permission, target?: PermissionTarget): boolean {
  const scope = PERMISSION_SCOPES[permission];
  if (scope === 'self') return target?.personId === actor.personId;
  if (actor.membershipStatus !== 'member') return false;
  if (actor.staffAdmin) return true;
  switch (scope) {
    case 'staff':
      return leadCommitteeIds(actor).length > 0;
    case 'admin':
      return false;
    case 'volunteer':
      return actor.workspaceLinked || actor.committees.length > 0;
    case 'person':
      return personScope(actor, permission, target);
    case 'committee':
      return committeeScope(actor, target);
    case 'event':
      return eventScope(actor, target);
    case 'welcome':
      return welcomeScope(actor, target);
  }
}
export class PermissionDenied extends Error {
  constructor(readonly permission: Permission) {
    super(ACCESS_DENIED);
    this.name = 'PermissionDenied';
  }
}
export function requirePermission(
  actor: Actor,
  permission: Permission,
  target?: PermissionTarget,
): void {
  if (!can(actor, permission, target)) throw new PermissionDenied(permission);
}
