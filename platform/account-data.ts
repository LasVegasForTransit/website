// A member's data: downloading everything LVBT holds about them, and
// deleting their account. Rendering lives in the site.

import {
  accountView,
  codeEmail,
  unsubscribeEverywhere,
  type AccountEnv,
  type CodeCheck,
} from './account';
import { checkCode, endAllSessions, requestCode } from './auth';
import { nowIso } from './core/ids';
import { regionName } from './core/regions';
import { formatFullDate, formatTime, t } from './messages';
import { sendCodeEmail } from './sign-in';
import type { Db } from './storage/db';
import { PersonService, type Person } from './storage/person-service';

// --- Your data -----------------------------------------------------------

/** Everything LVBT holds about one person, with a plain summary first. */
export async function exportData(
  db: Db,
  personId: string,
): Promise<Record<string, unknown> | null> {
  const view = await accountView(db, personId);
  if (!view) return null;
  const rows = async (sql: string) => (await db.prepare(sql).bind(personId).all()).results;
  const [consents, identities, events, fieldSources] = await Promise.all([
    rows(
      'SELECT scope, given_at, source, method, wording_version, withdrawn_at, withdrawn_source FROM consent_records WHERE person_id = ? ORDER BY given_at',
    ),
    rows(
      'SELECT platform, external_id, external_email, linked_at, link_method FROM identities WHERE person_id = ? ORDER BY linked_at',
    ),
    rows(
      'SELECT type, occurred_at, source, reference, details FROM engagement_events WHERE person_id = ? ORDER BY occurred_at',
    ),
    rows(
      'SELECT field, source, confirmed_at FROM field_sources WHERE person_id = ? ORDER BY field',
    ),
  ]);
  const { person } = view;
  return {
    summary: t('data.summary', {
      name: [person.given_name, person.family_name].filter(Boolean).join(' ') || '—',
      date: formatFullDate(new Date()),
    }),
    exported_at: nowIso(),
    details: {
      given_name: person.given_name,
      family_name: person.family_name,
      email: person.email,
      phone: person.phone,
      zip: person.zip,
      census_block: person.census_block,
      place_name: person.place_name,
      region: regionName(person.region_id),
      preferred_language: person.preferred_language,
      membership_status: person.membership_status,
      member_since: view.memberSince,
      created_at: person.created_at,
      updated_at: person.updated_at,
    },
    where_each_detail_came_from: fieldSources,
    consent_records: consents,
    connected_accounts: identities,
    activity: events.map((event) => ({
      ...event,
      details:
        typeof event.details === 'string' ? (JSON.parse(event.details) as unknown) : event.details,
    })),
  };
}

// --- Deleting the account ------------------------------------------------

export async function sendDeleteCode(
  env: AccountEnv,
  person: Pick<Person, 'id' | 'email'>,
  callerAddress: string,
  fetcher: typeof fetch = fetch,
): Promise<{ kind: 'sent' } | { kind: 'rate_limited'; retryAfter: string } | { kind: 'no_email' }> {
  if (!person.email) return { kind: 'no_email' };
  const outcome = await requestCode(env, {
    email: person.email,
    purpose: 'delete_account',
    callerAddress,
    personId: person.id,
  });
  if (outcome.kind === 'rate_limited') {
    return { kind: 'rate_limited', retryAfter: formatTime(outcome.retryAfter) };
  }
  if (outcome.kind === 'issued') {
    await sendCodeEmail(
      env,
      codeEmail(person.email, outcome.issued.code, 'delete_account'),
      fetcher,
    );
  }
  return { kind: 'sent' };
}

/**
 * Check the code and delete the account: off the mailing list, personal
 * details cleared now, signed out everywhere. The retention job removes the
 * row itself within 30 days.
 */
export async function deleteAccount(
  env: AccountEnv,
  person: Pick<Person, 'id' | 'email'>,
  code: string,
  fetcher: typeof fetch = fetch,
): Promise<CodeCheck> {
  const outcome = await checkCode(env, {
    email: '',
    code,
    purpose: 'delete_account',
    requestId: '',
    personId: person.id,
  });
  if (outcome.kind !== 'ok') return outcome;
  const people = new PersonService(env.PLATFORM_DB);
  await people.withdrawConsent(person.id, {
    scope: 'newsletter',
    source: 'account_deleted',
    withdrawnAt: nowIso(),
  });
  await unsubscribeEverywhere(env, person.id, fetcher);
  await people.recordEngagement(person.id, {
    type: 'account_deleted',
    occurredAt: nowIso(),
    source: 'member',
  });
  await people.deletePerson(person.id);
  await endAllSessions(env, person.id);
  return { kind: 'ok' };
}
