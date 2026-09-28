// Joining LVBT: everything that happens when someone submits the join form
// or the newsletter box. Rendering lives in the site; this module decides
// what happens and returns the outcome for the screen to show.

import {
  CONSENT_WORDING,
  hasErrors,
  normalizePhone,
  validateJoin,
  type JoinErrors,
  type JoinInput,
} from './core/join-form';
import { nowIso } from './core/ids';
import { isRegionId, regionForPlaces } from './core/regions';
import { hashWithSecret, signToken } from './core/signing';
import { subscribe, type SubscribeResult } from './integrations/beehiiv';
import { geocodeToBlock, type GeocodeResult } from './integrations/census';
import { emailConfigured, escapeHtml, sendEmail } from './integrations/email';
import { t } from './messages';
import type { Db } from './storage/db';
import {
  personForFormToken,
  recordFormToken,
  regionForZip,
  withinHourlyLimit,
} from './storage/limits';
import { PersonService, type PersonFields } from './storage/person-service';
import { getArray, notionClient, notionErrorMessage } from '../scripts/notion/lib/notion-client';
import { intakeLookupQuery, intakePage } from '../scripts/notion/lib/intake-page';

export interface PlatformEnv {
  PLATFORM_DB: Db;
  LVBT_LINK_SIGNING_SECRET: string;
  LVBT_BEEHIIV_API_KEY?: string;
  LVBT_BEEHIIV_PUBLICATION_ID?: string;
  LVBT_NOTION_API_KEY?: string;
  LVBT_NOTION_DATA_SOURCE_ID?: string;
  LVBT_RESEND_API_KEY?: string;
}

export const JOIN_LIMIT_PER_HOUR = 10;
export const REMOVAL_LINK_DAYS = 30;
export const SITE_ORIGIN = 'https://lasvegasfortransit.org';

export type AddressOutcome = 'none' | 'placed' | 'not_placed' | 'unavailable';

export type JoinOutcome =
  | { kind: 'discarded' }
  | { kind: 'rate_limited' }
  | { kind: 'invalid'; errors: JoinErrors }
  | { kind: 'unavailable' }
  | {
      kind: 'joined';
      personId: string;
      givenName: string;
      email: string;
      needsRegion: boolean;
      address: AddressOutcome;
    };

export interface JoinDependencies {
  fetcher?: typeof fetch;
  geocode?: (address: string) => Promise<GeocodeResult>;
}

function addressOutcome(result: GeocodeResult | null): AddressOutcome {
  if (!result) return 'none';
  if (result.kind === 'match') return 'placed';
  return result.kind === 'no_match' ? 'not_placed' : 'unavailable';
}

function personFields(input: JoinInput, geocoded: GeocodeResult | null): PersonFields {
  const fields: PersonFields = {
    email: input.email,
    given_name: input.givenName || null,
    family_name: input.familyName || null,
    phone: input.phone ? normalizePhone(input.phone) : null,
    zip: input.zip || null,
  };
  if (geocoded?.kind === 'match') {
    fields.census_block = geocoded.censusBlock;
    fields.census_block_vintage = geocoded.vintage;
    fields.zip = input.zip || geocoded.zip;
    fields.place_name = geocoded.places[0] ?? null;
  }
  return fields;
}

export async function removalLink(env: PlatformEnv, personId: string): Promise<string> {
  const token = await signToken(env.LVBT_LINK_SIGNING_SECRET, {
    purpose: 'remove_email',
    subject: personId,
    expiresAt: Date.now() + REMOVAL_LINK_DAYS * 24 * 60 * 60 * 1000,
  });
  return `${SITE_ORIGIN}/join/remove/?token=${encodeURIComponent(token)}`;
}

interface Recipient {
  personId: string;
  email: string;
  givenName: string;
}

async function sendConfirmation(
  env: PlatformEnv,
  recipient: Recipient,
  fetcher: typeof fetch,
): Promise<void> {
  const link = await removalLink(env, recipient.personId);
  const greeting = recipient.givenName
    ? t('email.joinGreetingNamed', { name: recipient.givenName })
    : t('email.joinGreeting');
  const body = t('email.joinBody');
  const remove = t('email.joinRemove');
  const signOff = t('email.signOff');
  await sendEmail(
    { resendApiKey: env.LVBT_RESEND_API_KEY },
    {
      to: recipient.email,
      subject: t('email.joinSubject'),
      template: 'join_confirmation',
      text: `${greeting}\n\n${body}\n\n${remove}: ${link}\n\n${signOff}`,
      html: `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(body)}</p><p><a href="${escapeHtml(link)}">${escapeHtml(remove)}</a></p><p>${escapeHtml(signOff)}</p>`,
    },
    fetcher,
  );
}

// Staff still follow up with new members from the Notion intake database
// until the staff console's welcome queue replaces it. Best effort: a Notion
// outage never stops someone joining.
async function addToNotionIntake(
  env: PlatformEnv,
  input: JoinInput,
  fetcher: typeof fetch,
): Promise<void> {
  if (!env.LVBT_NOTION_API_KEY || !env.LVBT_NOTION_DATA_SOURCE_ID) return;
  const name = [input.givenName, input.familyName].filter(Boolean).join(' ');
  const fields = {
    email: input.email,
    name: name || undefined,
    source: input.origin === 'join_form' ? 'Website join form' : 'Website newsletter box',
    submittedAt: nowIso(),
  };
  const notionFetch = notionClient(fetcher);
  try {
    const lookup = await notionFetch(
      env.LVBT_NOTION_API_KEY,
      'POST',
      `data_sources/${env.LVBT_NOTION_DATA_SOURCE_ID}/query`,
      intakeLookupQuery(fields),
    );
    if (lookup.ok && (getArray(lookup.json, 'results') ?? []).length > 0) return;
    const created = await notionFetch(
      env.LVBT_NOTION_API_KEY,
      'POST',
      'pages',
      intakePage(env.LVBT_NOTION_DATA_SOURCE_ID, fields),
    );
    if (!created.ok)
      console.error('Notion intake page create failed', notionErrorMessage(created.json));
  } catch {
    console.error('Notion intake request failed');
  }
}

// Checks that end a submission before anything is saved: the honeypot, the
// hourly limit and the field rules.
async function screen(
  env: PlatformEnv,
  input: JoinInput,
  callerAddress: string,
): Promise<JoinOutcome | null> {
  // Bots fill in the hidden field. They see the normal confirmation and
  // nothing is saved.
  if (input.honeypot) return { kind: 'discarded' };
  const bucket = await hashWithSecret(env.LVBT_LINK_SIGNING_SECRET, `join:${callerAddress}`);
  if (!(await withinHourlyLimit(env.PLATFORM_DB, bucket, JOIN_LIMIT_PER_HOUR))) {
    return { kind: 'rate_limited' };
  }
  const errors = validateJoin(input);
  return hasErrors(errors) ? { kind: 'invalid', errors } : null;
}

// A form that was already submitted joins nobody twice: answer as before.
async function repeatOutcome(
  people: PersonService,
  env: PlatformEnv,
  input: JoinInput,
): Promise<JoinOutcome | null> {
  if (!input.formToken) return null;
  const personId = await personForFormToken(env.PLATFORM_DB, input.formToken);
  if (!personId) return null;
  const person = await people.getPerson(personId);
  return {
    kind: 'joined',
    personId,
    givenName: person?.given_name ?? '',
    email: input.email,
    needsRegion: input.origin === 'join_form' && !person?.region_id,
    address: 'none',
  };
}

// An exact region from the address, or failing that one from the ZIP code.
// The person service keeps the higher-ranked source when both apply.
async function assignRegion(
  people: PersonService,
  env: PlatformEnv,
  personId: string,
  location: { geocoded: GeocodeResult | null; zip: string | null },
): Promise<void> {
  const { geocoded, zip } = location;
  if (geocoded?.kind === 'match') {
    const region = regionForPlaces(geocoded.censusBlock, geocoded.places);
    if (region) await people.setRegion(personId, region, 'address');
  }
  if (!zip) return;
  const region = await regionForZip(env.PLATFORM_DB, zip);
  if (region && isRegionId(region)) await people.setRegion(personId, region, 'zip');
}

async function recordMember(
  people: PersonService,
  input: JoinInput,
  geocoded: GeocodeResult | null,
  subscriptionId: string | null,
): Promise<string> {
  const { person } = await people.upsertFromSource({
    source: input.origin,
    fields: personFields(input, geocoded),
    consent: {
      scope: 'newsletter',
      source: input.origin,
      method: 'checkbox',
      wordingVersion: CONSENT_WORDING[input.origin],
    },
  });
  if (subscriptionId) {
    await people.linkIdentity(person.id, {
      platform: 'beehiiv',
      externalId: subscriptionId,
      externalEmail: input.email,
      linkMethod: 'created_by_platform',
    });
  }
  await people.recordEngagement(person.id, {
    type: 'joined',
    occurredAt: nowIso(),
    source: input.origin,
    details: { interests: input.interests },
  });
  return person.id;
}

function joinZip(input: JoinInput, geocoded: GeocodeResult | null): string | null {
  if (input.zip) return input.zip;
  return geocoded?.kind === 'match' ? geocoded.zip : null;
}

async function subscribeMember(
  env: PlatformEnv,
  input: JoinInput,
  fetcher: typeof fetch,
): Promise<SubscribeResult> {
  if (!env.LVBT_BEEHIIV_API_KEY || !env.LVBT_BEEHIIV_PUBLICATION_ID) {
    console.error('join: Beehiiv secrets are missing, so nobody can join');
    return { ok: false };
  }
  return subscribe(
    { apiKey: env.LVBT_BEEHIIV_API_KEY, publicationId: env.LVBT_BEEHIIV_PUBLICATION_ID },
    input.email,
    {
      // Until LVBT's own confirmation email can be sent, Beehiiv's welcome
      // email confirms the subscription instead.
      sendWelcomeEmail: !emailConfigured({ resendApiKey: env.LVBT_RESEND_API_KEY }),
      utmSource: input.origin,
    },
    fetcher,
  );
}

export async function processJoin(
  env: PlatformEnv,
  input: JoinInput,
  callerAddress: string,
  dependencies: JoinDependencies = {},
): Promise<JoinOutcome> {
  const fetcher = dependencies.fetcher ?? fetch;
  const stopped = await screen(env, input, callerAddress);
  if (stopped) return stopped;

  const people = new PersonService(env.PLATFORM_DB);
  const repeated = await repeatOutcome(people, env, input);
  if (repeated) return repeated;

  const geocode = dependencies.geocode ?? ((address: string) => geocodeToBlock(address, fetcher));
  const geocoded = input.address ? await geocode(input.address) : null;

  // Subscribe first: being on the mailing list is what makes someone a
  // member, so if Beehiiv fails nothing is recorded and the person retries.
  const subscription = await subscribeMember(env, input, fetcher);
  if (!subscription.ok) return { kind: 'unavailable' };

  const personId = await recordMember(people, input, geocoded, subscription.subscriptionId);
  await assignRegion(people, env, personId, { geocoded, zip: joinZip(input, geocoded) });
  const person = await people.getPerson(personId);
  const givenName = person?.given_name ?? '';

  if (input.formToken) await recordFormToken(env.PLATFORM_DB, input.formToken, personId);
  await Promise.all([
    sendConfirmation(env, { personId, email: input.email, givenName }, fetcher),
    addToNotionIntake(env, input, fetcher),
  ]);

  return {
    kind: 'joined',
    personId,
    givenName,
    email: input.email,
    needsRegion: input.origin === 'join_form' && !person?.region_id,
    address: addressOutcome(geocoded),
  };
}
