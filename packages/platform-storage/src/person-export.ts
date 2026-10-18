import { formatFullDate, t } from '@lasvegasfortransit/platform-core/messages';
import { INTERESTS, MICROMOBILITY } from '@lasvegasfortransit/platform-core/join-form';
import type { Db } from './db';
import { personalActivityFacts } from './person-export-facts';
import {
  exportQueries,
  exportStatement,
  type PersonExportAuthority,
} from './person-export-queries';

export type { PersonExportAuthority } from './person-export-queries';
type Row = Record<string, unknown>;
const SOURCES = new Set([
  'join_form',
  'newsletter_box',
  'google_form',
  'external_form',
  'account',
  'beehiiv',
  'member',
  'staff',
  'paper',
  'check_in',
  'import',
  'account_deleted',
  'retention',
  'newsletter_poll',
  'newsletter_webhook',
  'beehiiv_poll',
  'beehiiv_webhook',
  'beehiiv_observed',
  'merge',
]);
function source(value: unknown): string | null {
  return value === null ? null : typeof value === 'string' && SOURCES.has(value) ? value : 'other';
}
function safeSources(row: Row): Row {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      key === 'source' || key === 'withdrawn_source' ? source(value) : value,
    ]),
  );
}
const ACTIVITY_LABELS: Record<string, string> = {
  subscribed: 'Agreed to receive the newsletter',
  unsubscribed: 'Left the newsletter',
  joined: 'Joined LVBT',
  form_response: 'Submitted a form',
  welcomed: 'Received a welcome',
  rsvp: 'Responded to an event invitation',
  attended: 'Attended an event',
  donated: 'Made a donation',
  volunteer_shift: 'Volunteered',
  role_changed: 'Committee role changed',
  check_in_held: 'Had a check-in',
  correction: 'A record was corrected',
  duplicate_reviewed: 'A possible duplicate record was reviewed',
};
function object(value: unknown): Row {
  if (typeof value === 'string') {
    try {
      return object(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
}
function memberResponses(row: Row): Row | undefined {
  if (row.type !== 'joined' && row.type !== 'form_response') return undefined;
  const details = object(row.details);
  return {
    interests: Array.isArray(details.interests)
      ? details.interests.filter((value) => INTERESTS.some((interest) => interest === value))
      : [],
    owns_car: details.ownsCar === 'yes' || details.ownsCar === 'no' ? details.ownsCar : null,
    micromobility: Array.isArray(details.micromobility)
      ? details.micromobility.filter((value) => MICROMOBILITY.some((mode) => mode === value))
      : [],
  };
}
function activity(row: Row): Row {
  const type =
    typeof row.type === 'string' && Object.hasOwn(ACTIVITY_LABELS, row.type) ? row.type : 'other';
  return {
    type,
    description: ACTIVITY_LABELS[type] ?? 'Recorded activity',
    occurred_at: row.occurred_at,
    recorded_at: row.created_at,
    corrected: Boolean(row.corrected),
    facts: personalActivityFacts(type, object(row.details)),
    member_responses: memberResponses(row),
  };
}
function rows(result: unknown): Row[] {
  if (
    !result ||
    typeof result !== 'object' ||
    !('results' in result) ||
    !Array.isArray(result.results)
  )
    throw new Error('The personal export snapshot could not be read.');
  return result.results as Row[];
}
const CORRECTION_FIELDS = new Set([
  'given_name',
  'family_name',
  'email',
  'phone',
  'zip',
  'census_block',
  'census_block_vintage',
  'place_name',
  'preferred_language',
]);
function corrections(records: Row[], fields: string[], administrator: boolean): Row[] {
  return records.map((row) => {
    const changes: unknown =
      typeof row.changes === 'string' ? (JSON.parse(row.changes) as unknown) : null;
    const summary = {
      corrected_at: row.corrected_at,
      changed_fields: Array.isArray(changes)
        ? changes
            .map((value) => object(value).field)
            .filter((field) => typeof field === 'string' && fields.includes(field))
        : [],
    };
    if (!administrator) return summary;
    return {
      ...summary,
      changed_by: { id: row.actor_id, name: row.actor_name },
      reason: row.reason,
      changes: Array.isArray(changes)
        ? changes.flatMap((value) => {
            const change = object(value);
            return typeof change.field === 'string' &&
              CORRECTION_FIELDS.has(change.field) &&
              (change.before === null || typeof change.before === 'string') &&
              (change.after === null || typeof change.after === 'string')
              ? [{ field: change.field, before: change.before, after: change.after }]
              : [];
          })
        : [],
    };
  });
}

function memberSince(events: Row[]): string | null {
  const counted = events.filter((event) => !event.corrected && event.type !== 'correction');
  const unsubscribed =
    counted
      .filter((event) => event.type === 'unsubscribed')
      .map((event) => String(event.occurred_at))
      .sort()
      .at(-1) ?? '';
  return (
    counted
      .filter((event) => event.type === 'subscribed' && String(event.occurred_at) > unsubscribed)
      .map((event) => String(event.occurred_at))
      .sort()[0] ?? null
  );
}

const EXPORT_PRIVACY = {
  administrator:
    'Administrator copy: profile corrections include their recorded author, reason and previous and new profile values. Sign-in secrets and sessions, unrelated people, duplicate candidates and merge archives are excluded.',
  member:
    'Sign-in secrets and sessions, staff identifiers, duplicate candidates and merge archives are excluded.',
};

/** Read one person's snapshot, then authorize and receipt its export in one guarded write. */
export async function collectPersonExport(
  db: Db,
  personId: string,
  authority: PersonExportAuthority,
  now: Date = new Date(),
): Promise<Record<string, unknown> | null> {
  if (
    !authority.sessionHash ||
    !authority.personId ||
    (authority.kind === 'member' && authority.personId !== personId)
  )
    return null;
  const started = Date.now();
  const at = now.toISOString();
  const queries = exportQueries(db, personId, authority, at);
  const results = await db.batch(queries.map((query) => query.statement));
  const snapshot = Object.fromEntries(queries.map((query, i) => [query.section, rows(results[i])]));
  const person = snapshot.details?.[0];
  if (
    !person ||
    !(await exportStatement(db, {
      personId,
      authority,
      at: new Date(now.getTime() + Math.max(0, Date.now() - started)).toISOString(),
    }).first())
  )
    return null;
  const events = snapshot.activity ?? [];
  return {
    format_version: 2,
    summary: t('data.summary', {
      name: [person.given_name, person.family_name].filter(Boolean).join(' ') || '—',
      date: formatFullDate(now),
    }),
    exported_at: at,
    reading_this_file: {
      details: 'Your current profile and membership. Empty values mean the detail is not recorded.',
      consent:
        'Each agreement and withdrawal is separate evidence. An observed withdrawal time is when LVBT learned the status, which may be later than the choice.',
      newsletter:
        'Provider observations describe delivery status. A provider account creation date alone does not establish consent.',
      activity:
        'Your recorded activity, including corrections, recognized donation amounts and currencies, event participation, volunteer shifts, contact methods and role changes. Member responses include recognized participation and transport choices. Private staff notes, raw source payloads and references to other people are omitted.',
      privacy: EXPORT_PRIVACY[authority.kind],
    },
    details: { ...person, member_since: memberSince(events) },
    where_each_detail_came_from: (snapshot.where_each_detail_came_from ?? []).map(safeSources),
    consent_records: (snapshot.consent_records ?? []).map(safeSources),
    consent_withdrawals: (snapshot.consent_withdrawals ?? []).map(safeSources),
    connected_accounts: snapshot.connected_accounts,
    discord_account_profiles: snapshot.discord_account_profiles,
    discord_server_profiles: snapshot.discord_server_profiles,
    committee_assignments: snapshot.committee_assignments,
    organization_roles: snapshot.organization_roles,
    profile_corrections: corrections(
      snapshot.profile_corrections ?? [],
      Object.keys(person),
      authority.kind === 'administrator',
    ),
    activity: events.map(activity),
    newsletter_observations: snapshot.newsletter_observations,
    newsletter_choices: snapshot.newsletter_choices,
    newsletter_source_events: snapshot.newsletter_source_events,
    imported_signup_evidence: snapshot.imported_signup_evidence,
    current_membership_evidence: snapshot.current_membership_evidence,
  };
}
