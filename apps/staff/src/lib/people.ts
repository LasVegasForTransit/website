import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import type { MembershipStatus } from '@lasvegasfortransit/platform-core/membership';
import type { Person } from '@lasvegasfortransit/platform-storage/person-service';
import type { StaffPeopleQuery } from '@lasvegasfortransit/platform-storage/staff-people';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { STAFF_ADMIN_SCOPE } from '@lasvegasfortransit/platform-storage/staff-scope';
export const MEMBERSHIP_LABELS: Record<MembershipStatus, string> = {
  member: 'Member',
  former_member: 'Former member',
  not_member: 'Not a member',
};
export class PeopleQueryError extends Error {}
function optionalText(value: string | null | undefined) {
  const text = value?.trim();
  if (text === '') return undefined;
  return text;
}
export function personName(person: Person): string {
  const name = [person.given_name, person.family_name].filter(Boolean).join(' ');
  return optionalText(name) ?? optionalText(person.email) ?? 'Name not recorded';
}
export function peopleQuery(url: URL): StaffPeopleQuery {
  const status = peopleStatus(url);
  const membershipStatus = Object.hasOwn(MEMBERSHIP_LABELS, status)
    ? (status as MembershipStatus)
    : undefined;
  const zip = url.searchParams.get('zip')?.trim();
  if (status !== 'all' && !membershipStatus)
    throw new PeopleQueryError('Choose a membership status from the list.');
  if (zip && !/^\d{5}$/.test(zip)) throw new PeopleQueryError('Enter a five-digit ZIP code.');
  return {
    text: optionalText(url.searchParams.get('q')?.slice(0, 254)),
    email: optionalText(url.searchParams.get('email')?.slice(0, 254)),
    zip: optionalText(zip),
    membershipStatus,
    committeeId: optionalText(url.searchParams.get('committee')?.slice(0, 50)),
    cursor: optionalText(url.searchParams.get('cursor')),
    limit: 25,
  };
}
export function peopleStatus(url: URL): string {
  return (
    url.searchParams.get('status') ??
    (optionalText(url.searchParams.get('q')) || optionalText(url.searchParams.get('email'))
      ? 'all'
      : 'member')
  );
}
export function allMembershipsLink(url: URL): string {
  const next = new URL(url);
  next.searchParams.set('status', 'all');
  next.searchParams.delete('cursor');
  return `${next.pathname}${next.search}`;
}
export function pageLink(url: URL, cursor: string): string {
  const next = new URL(url);
  next.searchParams.set('cursor', cursor);
  return `${next.pathname}${next.search}`;
}
export async function visibleCommittees(db: Db, actor: Actor) {
  const { results } = await db
    .prepare(
      `SELECT c.id,c.name,c.accepting_members FROM committees c
    WHERE ${STAFF_ADMIN_SCOPE}
    OR EXISTS(SELECT 1 FROM committee_assignments a JOIN people viewer ON viewer.id=a.person_id WHERE a.committee_id=c.id AND a.person_id=? AND a.role='lead' AND a.ended_at IS NULL AND viewer.deleted_at IS NULL AND viewer.membership_status='member')
    ORDER BY c.name`,
    )
    .bind(actor.personId, actor.personId)
    .all<{ id: string; name: string; accepting_members: number }>();
  return results.map((item) => ({
    id: item.id,
    name: item.name,
    acceptingMembers: Boolean(item.accepting_members),
  }));
}
