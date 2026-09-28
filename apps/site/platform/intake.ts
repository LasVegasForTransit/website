// The intake interface, version 1: how any outside form tool adds a sign-up to
// the person record. It is documented for volunteers in
// docs/guides/connect-a-form-tool.md. Responses never reveal anything about
// any other person, so the interface can't be used to test whether an email
// address is on LVBT's list.

import { normalizePhone } from './core/join-form';
import { nowIso } from './core/ids';
import { subscribe } from './integrations/beehiiv';
import type { PlatformEnv } from './join';
import type { Db } from './storage/db';
import { PersonService, type PersonFields } from './storage/person-service';

export const INTAKE_SOURCES = ['google_form', 'join_form', 'external_form'] as const;
export type IntakeSource = (typeof INTAKE_SOURCES)[number];

export const IDEMPOTENCY_DAYS = 30;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LENGTH = 200;

export interface IntakeSubmission {
  idempotencyKey: string;
  source: IntakeSource;
  submittedAt: string;
  person: {
    givenName?: string;
    familyName?: string;
    email: string;
    phone?: string;
    zip?: string;
  };
  consent?: { newsletter: boolean; wordingVersion?: string };
  interests?: string[];
  heardFrom?: string;
}

export interface IntakeResponse {
  action: 'linked' | 'created' | 'created_and_queued';
}

export type ParseResult =
  { ok: true; submission: IntakeSubmission } | { ok: false; fields: string[] };

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, MAX_LENGTH);
  return trimmed || undefined;
}

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    const cleaned = text(item);
    return cleaned ? [cleaned] : [];
  });
}

interface Checked {
  submission: IntakeSubmission;
  invalid: string[];
}

function checkPerson(
  person: Record<string, unknown>,
  invalid: string[],
): IntakeSubmission['person'] {
  const email = text(person.email)?.toLowerCase() ?? '';
  if (!EMAIL_PATTERN.test(email)) invalid.push('person.email');
  const zip = text(person.zip);
  if (zip && !/^\d{5}$/.test(zip)) invalid.push('person.zip');
  const phone = text(person.phone);
  if (phone && normalizePhone(phone) === null) invalid.push('person.phone');
  return {
    email,
    givenName: text(person.givenName),
    familyName: text(person.familyName),
    phone: phone ? (normalizePhone(phone) ?? undefined) : undefined,
    zip,
  };
}

function check(body: Record<string, unknown>): Checked {
  const invalid: string[] = [];
  const idempotencyKey = text(body.idempotencyKey) ?? '';
  if (!idempotencyKey) invalid.push('idempotencyKey');
  const source = text(body.source) ?? '';
  if (!INTAKE_SOURCES.includes(source as IntakeSource)) invalid.push('source');
  const submittedAt = text(body.submittedAt) ?? '';
  if (!submittedAt || Number.isNaN(Date.parse(submittedAt))) invalid.push('submittedAt');
  const consent = record(body.consent);
  return {
    invalid,
    submission: {
      idempotencyKey,
      source: source as IntakeSource,
      submittedAt,
      person: checkPerson(record(body.person), invalid),
      consent:
        consent.newsletter === true
          ? { newsletter: true, wordingVersion: text(consent.wordingVersion) }
          : undefined,
      interests: strings(body.interests),
      heardFrom: text(body.heardFrom),
    },
  };
}

/** Read a request body. Invalid fields are named; their values are never echoed. */
export function parseIntake(body: unknown): ParseResult {
  const { submission, invalid } = check(record(body));
  return invalid.length > 0 ? { ok: false, fields: invalid } : { ok: true, submission };
}

async function previousResponse(db: Db, key: string): Promise<IntakeResponse | null> {
  const cutoff = new Date(Date.now() - IDEMPOTENCY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const row = await db
    .prepare(
      'SELECT response FROM intake_submissions WHERE idempotency_key = ? AND created_at >= ?',
    )
    .bind(key, cutoff)
    .first<{ response: string }>();
  return row ? (JSON.parse(row.response) as IntakeResponse) : null;
}

async function rememberResponse(
  db: Db,
  submission: IntakeSubmission,
  response: IntakeResponse,
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO intake_submissions (idempotency_key, source, response, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (idempotency_key) DO UPDATE SET response = excluded.response,
         created_at = excluded.created_at, updated_at = excluded.updated_at`,
    )
    .bind(submission.idempotencyKey, submission.source, JSON.stringify(response), now, now)
    .run();
}

function fields(submission: IntakeSubmission): PersonFields {
  const { person } = submission;
  return {
    email: person.email,
    given_name: person.givenName ?? null,
    family_name: person.familyName ?? null,
    phone: person.phone ?? null,
    zip: person.zip ?? null,
  };
}

/** What the intake needs from the platform environment. */
export type IntakeEnv = Pick<
  PlatformEnv,
  'PLATFORM_DB' | 'LVBT_BEEHIIV_API_KEY' | 'LVBT_BEEHIIV_PUBLICATION_ID'
>;

export interface IntakeOptions {
  /** Subscribe in Beehiiv when consent is given. The legacy Google Form handler already has. */
  subscribe: boolean;
  fetcher?: typeof fetch;
}

export type IntakeOutcome =
  { kind: 'processed'; response: IntakeResponse } | { kind: 'unavailable' };

async function subscribeIfConsented(
  env: IntakeEnv,
  submission: IntakeSubmission,
  options: IntakeOptions,
): Promise<boolean> {
  if (!options.subscribe || !submission.consent?.newsletter) return true;
  if (!env.LVBT_BEEHIIV_API_KEY || !env.LVBT_BEEHIIV_PUBLICATION_ID) return false;
  const result = await subscribe(
    { apiKey: env.LVBT_BEEHIIV_API_KEY, publicationId: env.LVBT_BEEHIIV_PUBLICATION_ID },
    submission.person.email,
    { sendWelcomeEmail: true, utmSource: submission.source },
    options.fetcher,
  );
  return result.ok;
}

export async function processIntake(
  env: IntakeEnv,
  submission: IntakeSubmission,
  options: IntakeOptions,
): Promise<IntakeOutcome> {
  const previous = await previousResponse(env.PLATFORM_DB, submission.idempotencyKey);
  if (previous) return { kind: 'processed', response: previous };

  // Subscribe first, as the join form does: if Beehiiv fails, nothing is
  // recorded and the form tool can send the same submission again.
  if (!(await subscribeIfConsented(env, submission, options))) return { kind: 'unavailable' };

  const people = new PersonService(env.PLATFORM_DB);
  const { person, action } = await people.upsertFromSource({
    source: submission.source,
    fields: fields(submission),
    consent: submission.consent?.newsletter
      ? {
          scope: 'newsletter',
          source: submission.source,
          method: 'checkbox',
          wordingVersion: submission.consent.wordingVersion ?? `${submission.source}-unversioned`,
        }
      : undefined,
  });
  await people.recordEngagement(person.id, {
    type: 'joined',
    occurredAt: submission.submittedAt,
    source: submission.source,
    reference: submission.idempotencyKey,
    details: { interests: submission.interests ?? [], heardFrom: submission.heardFrom ?? null },
  });
  const response: IntakeResponse = { action };
  await rememberResponse(env.PLATFORM_DB, submission, response);
  return { kind: 'processed', response };
}

// The Google Form's script posts its own shape to /api/membership-intake.
// This turns that into a version 1 submission, so the form keeps working
// unchanged. Submitting the form is joining, so it carries newsletter consent.
export const GOOGLE_FORM_WORDING = 'gform-2026-06';

export function googleFormSubmission(fields: {
  email: string;
  name?: string;
  submittedAt?: string;
  responseId?: string;
}): IntakeSubmission {
  const [givenName, ...rest] = (fields.name ?? '').split(/\s+/).filter(Boolean);
  const submittedAt =
    fields.submittedAt && !Number.isNaN(Date.parse(fields.submittedAt))
      ? fields.submittedAt
      : nowIso();
  return {
    idempotencyKey: `gform-${fields.responseId ?? `${fields.email}-${submittedAt}`}`,
    source: 'google_form',
    submittedAt,
    person: {
      email: fields.email,
      givenName,
      familyName: rest.length > 0 ? rest.join(' ') : undefined,
    },
    consent: { newsletter: true, wordingVersion: GOOGLE_FORM_WORDING },
  };
}
