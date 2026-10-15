import type { AccessConfiguration } from '@lasvegasfortransit/platform-core/access';
import type { AccessRow } from './access-view';
import type {
  CommitteeProviderSummary,
  CommitteeAccessSummary,
  CommitteeDiscordPerson,
} from './committee-access-types';
import { unknown } from './committee-access-summary';

export function uniqueDiscordRows(
  rows: AccessRow[],
  resources: string[],
): Array<AccessRow & { discordResourceId: string }> {
  const unique = new Map<string, AccessRow & { discordResourceId: string }>();
  for (const row of rows) {
    const resource = row.discordResourceId;
    if (!resource || !resources.includes(resource)) continue;
    const key = row.personId + ':' + resource,
      old = unique.get(key);
    if (isNewer(row, old)) unique.set(key, { ...row, discordResourceId: resource });
  }
  return [...unique.values()];
}
function isNewer(row: AccessRow, old: AccessRow | undefined): boolean {
  if (!old) return true;
  const order = (row.discord.observedAt ?? '').localeCompare(old.discord.observedAt ?? '');
  return order > 0 || (order === 0 && row.discord.state === 'unknown');
}
export function discordDifferences(
  rows: AccessRow[],
  selected: CommitteeAccessSummary,
): CommitteeDiscordPerson[] {
  const resources = [selected.discord.resourceId, selected.discordLeads.resourceId].filter(
    (id): id is string => !!id,
  );
  return uniqueDiscordRows(rows, resources)
    .filter(
      (row) =>
        row.discord.state !== 'unknown' &&
        row.discord.state !== (row.discordExpectedAccess ? 'granted' : 'absent'),
    )
    .map((row) => ({
      personId: row.personId,
      name: row.name,
      email: row.email,
      lead: row.discordResourceId === selected.discordLeads.resourceId,
      expected: row.discordExpectedAccess,
      actual: row.discord,
      firstSeenAt: row.discordFirstSeenAt,
      resourceId: row.discordResourceId,
    }))
    .sort(
      (a, b) => a.personId.localeCompare(b.personId) || a.resourceId.localeCompare(b.resourceId),
    );
}
export function discordSummary(
  rows: AccessRow[],
  resourceId: string | null,
  configuration: AccessConfiguration,
  unmatched: number,
): CommitteeProviderSummary {
  if (!resourceId) return unknown(null, 'not_mapped');
  if (!configuration.discord?.configured || !configuration.discord.contextId)
    return unknown(resourceId, 'not_configured');
  const people = uniqueDiscordRows(rows, [resourceId]);
  const checked = people.filter((row) => row.discord.state !== 'unknown');
  const dates = checked
    .map((row) => row.discord.observedAt)
    .filter((date): date is string => !!date);
  const mismatches = checked.filter(
    (row) => row.discord.state !== (row.discordExpectedAccess ? 'granted' : 'absent'),
  );
  return {
    resourceId,
    state: checked.length || unmatched ? 'current' : 'unknown',
    unmatched,
    holders:
      checked.length || unmatched
        ? checked.filter((row) => row.discord.state === 'granted').length + unmatched
        : null,
    missing: checked.length
      ? checked.filter((row) => row.discordExpectedAccess && row.discord.state === 'absent').length
      : null,
    unexpected: checked.length
      ? checked.filter((row) => !row.discordExpectedAccess && row.discord.state === 'granted')
          .length
      : null,
    unconfirmed: people.filter(
      (row) =>
        row.discord.state === 'unknown' && (row.discordExpectedAccess || row.discordConnected),
    ).length,
    checkedAt: dates.sort().at(0) ?? null,
    firstSeenAt:
      mismatches
        .map((row) => row.discordFirstSeenAt)
        .filter((date): date is string => !!date)
        .sort()
        .at(0) ?? null,
  };
}
