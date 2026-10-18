import type { ExportRow, FullExport } from '@lasvegasfortransit/platform-storage/full-export';

const direct = [
  'consent_records',
  'identities',
  'engagement_events',
  'field_sources',
  'committee_assignments',
  'person_organization_roles',
  'consent_withdrawals',
  'person_corrections',
  'roster_import_records',
  'membership_roll',
] as const;
type Related = (typeof direct)[number] | 'discord_identity_profiles' | 'discord_profiles';
type NestedPerson = Record<string, string | number | null | ExportRow[]> &
  Record<Related, ExportRow[]>;

/** Keep every related record with its person, without repeating the dataset. */
export function nestedExport(data: FullExport) {
  const people = new Map<string, NestedPerson>(
    data.people.map((person) => [
      String(person.id),
      {
        ...person,
        consent_records: [],
        identities: [],
        engagement_events: [],
        field_sources: [],
        committee_assignments: [],
        person_organization_roles: [],
        consent_withdrawals: [],
        person_corrections: [],
        roster_import_records: [],
        membership_roll: [],
        discord_identity_profiles: [],
        discord_profiles: [],
      },
    ]),
  );
  for (const table of direct) {
    for (const row of data[table]) {
      const owner = people.get(String(row.person_id));
      if (!owner) throw new Error('An exported record has no matching person.');
      owner[table].push(row);
    }
  }
  const identities = new Map(data.identities.map((row) => [String(row.id), String(row.person_id)]));
  for (const table of ['discord_identity_profiles', 'discord_profiles'] as const) {
    for (const row of data[table]) {
      const identityOwner = identities.get(String(row.identity_record_id));
      const owner = identityOwner ? people.get(identityOwner) : undefined;
      if (!owner) throw new Error('An exported account observation has no matching person.');
      owner[table].push(row);
    }
  }
  return {
    formatVersion: data.formatVersion,
    exportedAt: data.exportedAt,
    people: [...people.values()],
    organization_roles: data.organization_roles,
    unassigned_roster_import_records: data.unassigned_roster_import_records,
  };
}
