// A signed-in member's own account: what LVBT holds about them, correcting
// it, and leaving or rejoining the mailing list. Downloading everything and
// deleting the account are in account-data.ts. Rendering lives in the site; this module decides what
// happens and returns the outcome for the screen to show.

import { checkCode, requestCode } from './auth';
import { nowIso } from './core/ids';
import { normalizePhone } from './core/join-form';
import { isRegionId, regionForPlaces, regionName } from './core/regions';
import { subscribe, unsubscribe } from './integrations/beehiiv';
import { geocodeToBlock, type GeocodeResult } from './integrations/census';
import { escapeHtml, sendEmail } from './integrations/email';
import { formatTime, t } from './messages';
import { sendCodeEmail, validEmail, type SignInEnv } from './sign-in';
import type { Db } from './storage/db';
import { regionForZip } from './storage/limits';
import { normalizeEmail, PersonService, type Person } from './storage/person-service';

export interface AccountEnv extends SignInEnv {
  LVBT_BEEHIIV_API_KEY?: string;
  LVBT_BEEHIIV_PUBLICATION_ID?: string;
}

export interface AccountDependencies {
  fetcher?: typeof fetch;
  geocode?: (address: string) => Promise<GeocodeResult>;
}

/** The consent wording shown next to "Rejoin the mailing list". */
export const REJOIN_WORDING = 'account-rejoin-2026-09';

export interface AccountView {
  person: Person;
  onMailingList: boolean;
  memberSince: string | null;
  area: string | null;
}

export async function accountView(db: Db, personId: string): Promise<AccountView | null> {
  const person = await new PersonService(db).getPerson(personId);
  if (!person) return null;
  const consent = await db
    .prepare(
      `SELECT min(given_at) AS since FROM consent_records
       WHERE person_id = ? AND scope = 'newsletter' AND withdrawn_at IS NULL`,
    )
    .bind(personId)
    .first<{ since: string | null }>();
  const since = consent?.since ?? null;
  return {
    person,
    onMailingList: since !== null,
    memberSince: since,
    area: areaLabel(person),
  };
}

/** The area as a member reads it: their ZIP code and region, or null. */
export function areaLabel(person: Pick<Person, 'zip' | 'region_id' | 'place_name'>): string | null {
  const region = regionName(person.region_id);
  const parts = [person.zip, region ?? person.place_name].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

// --- Details -------------------------------------------------------------

export async function updateName(
  db: Db,
  personId: string,
  givenName: string,
  familyName: string,
): Promise<void> {
  await new PersonService(db).updateFields(personId, {
    source: 'member',
    fields: { given_name: givenName.trim(), family_name: familyName.trim() },
    allowClear: true,
  });
}

export async function updatePhone(
  db: Db,
  personId: string,
  raw: string,
): Promise<'updated' | 'invalid'> {
  const trimmed = raw.trim();
  const phone = trimmed ? normalizePhone(trimmed) : '';
  if (phone === null) return 'invalid';
  await new PersonService(db).updateFields(personId, {
    source: 'member',
    fields: { phone },
    allowClear: true,
  });
  return 'updated';
}

export type AreaOutcome =
  'updated' | 'placed' | 'not_placed' | 'unavailable' | 'invalid_zip' | 'empty';

/**
 * Set the member's area from a home address, which is used once and never
 * stored, or from a ZIP code alone.
 */
export async function updateArea(
  db: Db,
  personId: string,
  input: { address: string; zip: string },
  dependencies: AccountDependencies = {},
): Promise<AreaOutcome> {
  const address = input.address.trim();
  const zip = input.zip.trim();
  const people = new PersonService(db);
  if (address) {
    const geocode =
      dependencies.geocode ?? ((value: string) => geocodeToBlock(value, dependencies.fetcher));
    const result = await geocode(address);
    if (result.kind === 'no_match') return 'not_placed';
    if (result.kind === 'unavailable') return 'unavailable';
    await people.updateFields(personId, {
      source: 'member',
      fields: {
        census_block: result.censusBlock,
        census_block_vintage: result.vintage,
        zip: result.zip ?? (zip || null),
        place_name: result.places[0] ?? null,
      },
      allowClear: true,
    });
    const region = regionForPlaces(result.censusBlock, result.places);
    if (region) await people.setRegion(personId, region, 'address');
    return 'placed';
  }
  if (!zip) return 'empty';
  if (!/^\d{5}$/.test(zip)) return 'invalid_zip';
  // A ZIP code alone replaces an exact location, which may no longer be right.
  await people.updateFields(personId, {
    source: 'member',
    fields: { zip, census_block: null, census_block_vintage: null, place_name: null },
    allowClear: true,
  });
  const region = await regionForZip(db, zip);
  if (region && isRegionId(region)) await people.setRegion(personId, region, 'zip');
  return 'updated';
}

// --- Email ---------------------------------------------------------------

export type EmailChangeStart =
  | { kind: 'sent'; newEmail: string }
  | { kind: 'invalid' }
  | { kind: 'same' }
  | { kind: 'taken' }
  | { kind: 'rate_limited'; retryAfter: string };

/** Send a code to the new address; the change happens once it is entered. */
export async function startEmailChange(
  env: AccountEnv,
  person: Pick<Person, 'id' | 'email'>,
  input: { email: string; callerAddress: string },
  fetcher: typeof fetch = fetch,
): Promise<EmailChangeStart> {
  const { callerAddress } = input;
  const newEmail = normalizeEmail(input.email);
  if (!validEmail(newEmail)) return { kind: 'invalid' };
  if (newEmail === person.email) return { kind: 'same' };
  const other = await new PersonService(env.PLATFORM_DB).findByEmail(newEmail);
  if (other && other.id !== person.id) return { kind: 'taken' };
  const outcome = await requestCode(env, {
    email: newEmail,
    purpose: 'confirm_email',
    callerAddress,
    personId: person.id,
    newEmail,
  });
  if (outcome.kind === 'rate_limited') {
    return { kind: 'rate_limited', retryAfter: formatTime(outcome.retryAfter) };
  }
  if (outcome.kind === 'issued') {
    await sendCodeEmail(env, codeEmail(newEmail, outcome.issued.code, 'confirm_email'), fetcher);
  }
  return { kind: 'sent', newEmail };
}

export function codeEmail(to: string, code: string, template: 'confirm_email' | 'delete_account') {
  const confirming = template === 'confirm_email';
  const subject = confirming
    ? t('email.confirmSubject', { code })
    : t('email.deleteSubject', { code });
  const body = confirming ? t('email.confirmBody', { code }) : t('email.deleteBody', { code });
  const ignore = t('email.signInIgnore');
  const signOff = t('email.signOff');
  return {
    to,
    subject,
    template,
    text: `${body}\n\n${ignore}\n\n${signOff}`,
    html: `<p style="font-size:18px">${escapeHtml(body)}</p><p>${escapeHtml(ignore)}</p><p>${escapeHtml(signOff)}</p>`,
  };
}

export type CodeCheck =
  | { kind: 'ok' }
  | { kind: 'wrong'; triesLeft: number }
  | { kind: 'too_many' }
  | { kind: 'expired' }
  | { kind: 'taken' };

/** Check the code sent to the new address and, if it matches, change the email. */
export async function confirmEmailChange(
  env: AccountEnv,
  person: Pick<Person, 'id' | 'email'>,
  code: string,
  fetcher: typeof fetch = fetch,
): Promise<CodeCheck> {
  const outcome = await checkCode(env, {
    email: '',
    code,
    purpose: 'confirm_email',
    requestId: '',
    personId: person.id,
  });
  if (outcome.kind !== 'ok') return outcome;
  const newEmail = outcome.newEmail;
  if (!newEmail) return { kind: 'expired' };
  const people = new PersonService(env.PLATFORM_DB);
  const other = await people.findByEmail(newEmail);
  if (other && other.id !== person.id) return { kind: 'taken' };

  const now = nowIso();
  await people.updateFields(person.id, { source: 'member', fields: { email: newEmail } });
  await env.PLATFORM_DB.prepare('UPDATE people SET email_verified_at = ? WHERE id = ?')
    .bind(now, person.id)
    .run();
  await moveMailingListAddress(env, person.id, newEmail, fetcher);
  if (person.email) {
    const body = t('email.emailChangedBody', { email: newEmail });
    await sendEmail(
      { resendApiKey: env.LVBT_RESEND_API_KEY },
      {
        to: person.email,
        subject: t('email.emailChangedSubject'),
        template: 'email_changed',
        text: `${body}\n\n${t('email.signOff')}`,
        html: `<p>${escapeHtml(body)}</p><p>${escapeHtml(t('email.signOff'))}</p>`,
      },
      fetcher,
    );
  }
  return { kind: 'ok' };
}

// --- Mailing list --------------------------------------------------------

function beehiiv(env: AccountEnv) {
  return env.LVBT_BEEHIIV_API_KEY && env.LVBT_BEEHIIV_PUBLICATION_ID
    ? { apiKey: env.LVBT_BEEHIIV_API_KEY, publicationId: env.LVBT_BEEHIIV_PUBLICATION_ID }
    : null;
}

async function beehiivIds(db: Db, personId: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      "SELECT external_id AS externalId FROM identities WHERE person_id = ? AND platform = 'beehiiv'",
    )
    .bind(personId)
    .all<{ externalId: string }>();
  return results.map((row) => row.externalId);
}

/** Unsubscribe every Beehiiv subscription linked to the person. */
export async function unsubscribeEverywhere(
  env: AccountEnv,
  personId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const config = beehiiv(env);
  if (!config) {
    console.error('account: Beehiiv secrets are missing, so the unsubscribe is not sent');
    return;
  }
  for (const id of await beehiivIds(env.PLATFORM_DB, personId)) {
    await unsubscribe(config, id, fetcher);
  }
}

async function subscribeAddress(
  env: AccountEnv,
  personId: string,
  email: string,
  fetcher: typeof fetch,
): Promise<boolean> {
  const config = beehiiv(env);
  if (!config) return false;
  const result = await subscribe(
    config,
    email,
    { sendWelcomeEmail: false, utmSource: 'account' },
    fetcher,
  );
  if (!result.ok) return false;
  if (result.subscriptionId) {
    await new PersonService(env.PLATFORM_DB).linkIdentity(personId, {
      platform: 'beehiiv',
      externalId: result.subscriptionId,
      externalEmail: email,
      linkMethod: 'verified_email',
    });
  }
  return true;
}

// After an email change, the mailing list follows the new address.
async function moveMailingListAddress(
  env: AccountEnv,
  personId: string,
  newEmail: string,
  fetcher: typeof fetch,
): Promise<void> {
  const view = await accountView(env.PLATFORM_DB, personId);
  if (!view?.onMailingList) return;
  await unsubscribeEverywhere(env, personId, fetcher);
  await subscribeAddress(env, personId, newEmail, fetcher);
}

export async function leaveMailingList(
  env: AccountEnv,
  personId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await new PersonService(env.PLATFORM_DB).withdrawConsent(personId, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: nowIso(),
  });
  await unsubscribeEverywhere(env, personId, fetcher);
}

export async function rejoinMailingList(
  env: AccountEnv,
  person: Pick<Person, 'id' | 'email'>,
  fetcher: typeof fetch = fetch,
): Promise<'rejoined' | 'unavailable'> {
  if (!person.email) return 'unavailable';
  // As when joining: being on the mailing list is what makes someone a
  // member, so nothing is recorded unless Beehiiv takes the address.
  if (!(await subscribeAddress(env, person.id, person.email, fetcher))) return 'unavailable';
  await new PersonService(env.PLATFORM_DB).recordConsent(person.id, {
    scope: 'newsletter',
    source: 'account',
    method: 'checkbox',
    wordingVersion: REJOIN_WORDING,
    givenAt: nowIso(),
  });
  return 'rejoined';
}
