import type { AccessConfiguration } from '@lasvegasfortransit/platform-core/access';
import type { AccessRow } from './access-view';
export interface CommitteeProviderSummary {
  resourceId: string | null;
  state: 'current' | 'unknown' | 'not_configured' | 'not_mapped';
  holders: number | null;
  missing: number | null;
  unexpected: number | null;
  unconfirmed: number;
  unmatched: number;
  checkedAt: string | null;
  firstSeenAt: string | null;
}
export interface CommitteeAccessSummary {
  id: string;
  name: string;
  expectedPeople: number;
  google: CommitteeProviderSummary;
  discord: CommitteeProviderSummary;
  discordLeads: CommitteeProviderSummary;
}
export interface CommitteeOverviewQuery {
  configuration: AccessConfiguration;
  consoleGroupEmail: string | null;
  now: Date;
  committeeId?: string;
  includeUnmapped?: boolean;
  cursor?: string | undefined;
  limit?: number;
}
export interface CommitteeDiscordPerson {
  personId: string;
  name: string;
  email: string | null;
  lead: boolean;
  expected: boolean;
  actual: AccessRow['discord'];
  firstSeenAt: string | null;
  resourceId: string;
}
