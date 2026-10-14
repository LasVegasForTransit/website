// The intake interface, version 1: how any outside form tool adds a sign-up to
// the person record. It is documented for volunteers in
// docs/guides/connect-a-form-tool.md. Responses never reveal anything about
// any other person, so the interface can't be used to test whether an email
// address is on LVBT's list.

import { normalizePhone } from '@lasvegasfortransit/platform-core/join-form';
import { nowIso } from '@lasvegasfortransit/platform-core/ids';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import type { PlatformEnv } from './join';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { queryBudget } from '@lasvegasfortransit/platform-storage/query-budget';
import {
  PersonService,
  type PersonFields,
} from '@lasvegasfortransit/platform-storage/person-service';

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
    givenName?: string | undefined;
    familyName?: string | undefined;
    email: string;
    phone?: string | undefined;
    zip?: string | undefined;
  };
  consent?: { newsletter: boolean; wordingVersion?: string | undefined } | undefined;
  interests?: string[] | undefined;
  heardFrom?: string | undefined;
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

async function receiptKey(submission: IntakeSubmission): Promise<string> {
  return `intake:${await digestToken(`${submission.source}\0${submission.idempotencyKey}`)}`;
}
async function previousResponse(
  db: Db,
  submission: IntakeSubmission,
  key: string,
): Promise<IntakeResponse | null> {
  const cutoff = new Date(Date.now() - IDEMPOTENCY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const row = await db
    .prepare(
      `SELECT idempotency_key,response,created_at FROM intake_submissions
       WHERE ((idempotency_key=? AND json_extract(response,'$.receiptVersion')=1)
         OR (idempotency_key=? AND json_type(response,'$.receiptVersion') IS NULL))
         AND source=? AND created_at>=? ORDER BY (idempotency_key=?) DESC LIMIT 1`,
    )
    .bind(key, submission.idempotencyKey, submission.source, cutoff, key)
    .first<{ idempotency_key: string; response: string; created_at: string }>();
  if (!row) return null;
  const stored = JSON.parse(row.response) as IntakeResponse & { receiptVersion?: number };
  if (!['created', 'linked', 'created_and_queued'].includes(stored.action))
    throw new Error('Invalid intake receipt');
  const response = { action: stored.action };
  if (stored.receiptVersion !== 1) {
    await rememberResponse(db, submission, response, { key, createdAt: row.created_at });
    if (row.idempotency_key !== key)
      await db
        .prepare('DELETE FROM intake_submissions WHERE idempotency_key=? AND source=?')
        .bind(row.idempotency_key, submission.source)
        .run();
  }
  return response;
}

async function rememberResponse(
  db: Db,
  submission: IntakeSubmission,
  response: IntakeResponse,
  receipt: { key: string; createdAt?: string },
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO intake_submissions (idempotency_key, source, response, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (idempotency_key) DO UPDATE SET response = excluded.response,
         created_at = excluded.created_at, updated_at = excluded.updated_at`,
    )
    .bind(
      receipt.key,
      submission.source,
      JSON.stringify({ ...response, receiptVersion: 1 }),
      receipt.createdAt ?? now,
      now,
    )
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
export type IntakeEnv = Pick<PlatformEnv, 'PLATFORM_DB'>;

export type IntakeOutcome =
  { kind: 'processed'; response: IntakeResponse } | { kind: 'unavailable' };

async function recordIntake(env: IntakeEnv, submission: IntakeSubmission): Promise<IntakeOutcome> {
  const key = await receiptKey(submission);
  const previous = await previousResponse(env.PLATFORM_DB, submission, key);
  if (previous) return { kind: 'processed', response: previous };

  const submittedAt = new Date(submission.submittedAt).toISOString();
  if (Date.parse(submittedAt) > Date.now()) return { kind: 'unavailable' };
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
          givenAt: submittedAt,
        }
      : undefined,
  });
  await people.recordEngagement(person.id, {
    type: submission.consent?.newsletter ? 'joined' : 'form_response',
    occurredAt: submittedAt,
    source: submission.source,
    reference: submission.idempotencyKey,
    details: { interests: submission.interests ?? [], heardFrom: submission.heardFrom ?? null },
  });
  const response: IntakeResponse = { action };
  await rememberResponse(env.PLATFORM_DB, submission, response, { key });
  return { kind: 'processed', response };
}

export async function processIntake(
  env: IntakeEnv,
  submission: IntakeSubmission,
): Promise<IntakeOutcome> {
  try {
    return await recordIntake({ PLATFORM_DB: queryBudget(env.PLATFORM_DB, 50).db }, submission);
  } catch {
    return { kind: 'unavailable' };
  }
}

// The Google Form's script posts its own shape to /api/membership-intake.
// This turns that into a version 1 submission, so the form keeps working
// unchanged. Only its affirmative newsletter answer carries consent.
export const GOOGLE_FORM_WORDING = 'gform-2026-06';
export const GOOGLE_FORM_NEWSLETTER_QUESTION =
  'Finishing this form will sign you up for our email newsletter. Is this okay?';

export function googleFormSubmission(fields: {
  email: string;
  name?: string | undefined;
  submittedAt?: string | undefined;
  responseId?: string | undefined;
  answers?: unknown;
}): IntakeSubmission {
  const [givenName, ...rest] = (fields.name ?? '').split(/\s+/).filter(Boolean);
  const time = Date.parse(fields.submittedAt ?? '');
  const knownTime = Number.isFinite(time) && time <= Date.now();
  const submittedAt = knownTime ? new Date(time).toISOString() : nowIso();
  const agrees = record(fields.answers)[GOOGLE_FORM_NEWSLETTER_QUESTION] === 'Yes';
  return {
    idempotencyKey: `gform-${fields.responseId ?? `${fields.email}-${fields.submittedAt ?? 'unknown'}`}`,
    source: 'google_form',
    submittedAt,
    person: {
      email: fields.email,
      givenName,
      familyName: rest.length > 0 ? rest.join(' ') : undefined,
    },
    consent:
      agrees && knownTime ? { newsletter: true, wordingVersion: GOOGLE_FORM_WORDING } : undefined,
  };
}
