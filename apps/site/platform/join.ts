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
} from '@lasvegasfortransit/platform-core/join-form';
import { nowIso } from '@lasvegasfortransit/platform-core/ids';
import { isRegionId, regionForPlaces } from '@lasvegasfortransit/platform-core/regions';
import { hashWithSecret, signToken } from '@lasvegasfortransit/platform-core/signing';
import {
  geocodeToBlock,
  type GeocodeResult,
} from '@lasvegasfortransit/platform-integrations/census';
import { sendEmail } from '@lasvegasfortransit/platform-integrations/email';
import { featuredWelcomeAction, memberWelcomeEmail, welcomeAction } from './member-welcome';
import { t } from '@lasvegasfortransit/platform-core/messages';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  personForFormToken,
  recordFormToken,
  regionForZip,
  withinHourlyLimit,
} from '@lasvegasfortransit/platform-storage/limits';
import {
  PersonService,
  type PersonFields,
} from '@lasvegasfortransit/platform-storage/person-service';

export interface PlatformEnv {
  PLATFORM_DB: Db;
  LVBT_LINK_SIGNING_SECRET: string;
  LVBT_BEEHIIV_API_KEY?: string;
  LVBT_BEEHIIV_PUBLICATION_ID?: string;
  LVBT_RESEND_API_KEY?: string;
}

export const JOIN_LIMIT_PER_HOUR = 10;
export const REMOVAL_LINK_DAYS = 730;
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
  interests: JoinInput['interests'];
  referral: JoinInput['referral'];
}

async function sendConfirmation(
  env: PlatformEnv,
  recipient: Recipient,
  fetcher: typeof fetch,
): Promise<void> {
  const link = await removalLink(env, recipient.personId);
  const featured = await featuredWelcomeAction(
    env.PLATFORM_DB,
    recipient.referral,
    recipient.interests,
  );
  const { text, html } = memberWelcomeEmail({
    givenName: recipient.givenName,
    action: welcomeAction(recipient.interests, featured),
    unsubscribeUrl: link,
  });
  await sendEmail(
    { resendApiKey: env.LVBT_RESEND_API_KEY },
    {
      to: recipient.email,
      subject: t('email.joinSubject'),
      template: 'join_confirmation',
      text,
      html,
      headers: {
        'List-Unsubscribe': `<${link}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    },
    fetcher,
  );
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
  const person = await people.getExactPerson(personId);
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
  givenAt: string,
): Promise<string> {
  const { person } = await people.upsertFromSource({
    source: input.origin,
    fields: personFields(input, geocoded),
    consent: {
      scope: 'newsletter',
      source: input.origin,
      method: 'checkbox',
      wordingVersion: CONSENT_WORDING[input.origin],
      givenAt,
    },
  });
  if (person.membership_status !== 'member') return person.id;
  await people.recordEngagement(person.id, {
    type: 'joined',
    occurredAt: nowIso(),
    source: input.origin,
    details: {
      interests: input.interests,
      referral: input.referral,
      discordUsername: input.discordUsername || null,
      ownsCar: input.ownsCar,
      micromobility: input.micromobility,
    },
  });
  return person.id;
}

function joinZip(input: JoinInput, geocoded: GeocodeResult | null): string | null {
  if (input.zip) return input.zip;
  return geocoded?.kind === 'match' ? geocoded.zip : null;
}

export async function processJoin(
  env: PlatformEnv,
  input: JoinInput,
  callerAddress: string,
  dependencies: JoinDependencies = {},
): Promise<JoinOutcome> {
  const givenAt = nowIso();
  const fetcher = dependencies.fetcher ?? fetch;
  const stopped = await screen(env, input, callerAddress);
  if (stopped) return stopped;

  const people = new PersonService(env.PLATFORM_DB);
  const repeated = await repeatOutcome(people, env, input);
  if (repeated) return repeated;

  const geocode = dependencies.geocode ?? ((address: string) => geocodeToBlock(address, fetcher));
  const geocoded = input.address ? await geocode(input.address) : null;

  const personId = await recordMember(people, input, geocoded, givenAt);
  if (input.formToken) await recordFormToken(env.PLATFORM_DB, input.formToken, personId);
  await assignRegion(people, env, personId, { geocoded, zip: joinZip(input, geocoded) });
  const person = await people.getExactPerson(personId);
  if (person?.membership_status !== 'member') return { kind: 'discarded' };
  const givenName = person.given_name ?? '';

  await sendConfirmation(
    env,
    {
      personId,
      email: input.email,
      givenName,
      interests: input.interests,
      referral: input.referral,
    },
    fetcher,
  );

  return {
    kind: 'joined',
    personId,
    givenName,
    email: input.email,
    needsRegion: input.origin === 'join_form' && !person.region_id,
    address: addressOutcome(geocoded),
  };
}
