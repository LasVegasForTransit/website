// Member sign-in: one-time codes and sign-in links sent by email, sessions,
// and the limits that stop guessing and flooding. Nothing a visitor sees ever
// reveals whether an email address is on LVBT's list. Codes, link tokens and
// session identifiers are stored only as keyed hashes (LVBT_SIGN_IN_SECRET).

import { ulid } from './core/ids';
import { hashWithSecret } from './core/signing';
import type { Db } from './storage/db';
import { withinDailyLimit, withinHourlyLimit } from './storage/limits';
import { normalizeEmail } from './storage/person-service';

export type CodePurpose = 'sign_in' | 'confirm_email' | 'delete_account';

export const CODE_MINUTES = 15;
export const ATTEMPTS_PER_CODE = 5;
export const CODES_PER_EMAIL_PER_HOUR = 5;
export const CODE_REQUESTS_PER_ADDRESS_PER_HOUR = 20;
export const MEMBER_SESSION_DAYS = 30;
export const STAFF_SESSION_HOURS = 12;
const SESSION_TOUCH_MS = 60 * 60 * 1000;

export interface AuthEnv {
  PLATFORM_DB: Db;
  LVBT_SIGN_IN_SECRET: string;
}

const MINUTE = 60 * 1000;

function randomToken(bytes = 32): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const value of values) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** A uniformly random 6-digit code, leading zeros kept. */
export function randomCode(): string {
  const limit = Math.floor(0xffffffff / 1_000_000) * 1_000_000;
  for (;;) {
    const [value = 0] = crypto.getRandomValues(new Uint32Array(1));
    if (value < limit) return String(value % 1_000_000).padStart(6, '0');
  }
}

function hash(env: AuthEnv, kind: string, value: string): Promise<string> {
  return hashWithSecret(env.LVBT_SIGN_IN_SECRET, `${kind}:${value}`);
}

export interface IssuedCode {
  code: string;
  linkToken: string;
}

export type RequestOutcome =
  | { kind: 'issued'; personId: string; issued: IssuedCode }
  | { kind: 'no_person' }
  | { kind: 'rate_limited'; retryAfter: Date };

function nextHour(now: Date): Date {
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next;
}

/**
 * Issue a code and link for `email`, if it belongs to someone. The caller
 * shows the same page either way and emails the code only when issued.
 * A new code makes the person's earlier unused codes for the same purpose
 * stop working.
 */
export async function requestCode(
  env: AuthEnv,
  input: {
    email: string;
    purpose: CodePurpose;
    callerAddress: string;
    /** For confirm_email: whose email is changing, and to what. */
    personId?: string;
    newEmail?: string;
    now?: Date;
  },
): Promise<RequestOutcome> {
  const now = input.now ?? new Date();
  const email = normalizeEmail(input.email);
  const addressBucket = await hash(env, 'code-request-address', input.callerAddress);
  const emailBucket = await hash(env, 'code-request-email', email);
  const addressOk = await withinHourlyLimit(
    env.PLATFORM_DB,
    addressBucket,
    CODE_REQUESTS_PER_ADDRESS_PER_HOUR,
    now,
  );
  const emailOk = await withinHourlyLimit(
    env.PLATFORM_DB,
    emailBucket,
    CODES_PER_EMAIL_PER_HOUR,
    now,
  );
  if (!addressOk || !emailOk) return { kind: 'rate_limited', retryAfter: nextHour(now) };

  let personId = input.personId ?? null;
  if (!personId) {
    const person = await env.PLATFORM_DB.prepare(
      'SELECT id FROM people WHERE email = ? AND deleted_at IS NULL',
    )
      .bind(email)
      .first<{ id: string }>();
    personId = person?.id ?? null;
  }
  if (!personId) return { kind: 'no_person' };

  const issued = { code: randomCode(), linkToken: randomToken() };
  const stamp = now.toISOString();
  await env.PLATFORM_DB.batch([
    env.PLATFORM_DB.prepare(
      `UPDATE sign_in_codes SET used_at = ?, updated_at = ?
       WHERE person_id = ? AND purpose = ? AND used_at IS NULL`,
    ).bind(stamp, stamp, personId, input.purpose),
    env.PLATFORM_DB.prepare(
      `INSERT INTO sign_in_codes (id, person_id, purpose, code_hash, link_token_hash, new_email, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      ulid(now.getTime()),
      personId,
      input.purpose,
      await hash(env, 'code', issued.code),
      await hash(env, 'link', issued.linkToken),
      input.newEmail ? normalizeEmail(input.newEmail) : null,
      new Date(now.getTime() + CODE_MINUTES * MINUTE).toISOString(),
      stamp,
      stamp,
    ),
  ]);
  return { kind: 'issued', personId, issued };
}

/**
 * Whether an address that belongs to no one may be sent the "not a member
 * yet" email now: once a day per address, so the sign-in form can't be used
 * to fill a stranger's inbox.
 */
export function mayTellStranger(
  env: AuthEnv,
  email: string,
  now: Date = new Date(),
): Promise<boolean> {
  return hash(env, 'stranger-notice', normalizeEmail(email)).then((bucket) =>
    withinDailyLimit(env.PLATFORM_DB, bucket, 1, now),
  );
}

export type CheckOutcome =
  | { kind: 'ok'; personId: string; newEmail: string | null }
  | { kind: 'wrong'; triesLeft: number }
  | { kind: 'too_many' }
  | { kind: 'expired' };

interface CodeRow {
  id: string;
  person_id: string;
  code_hash: string;
  new_email: string | null;
  expires_at: string;
  attempts: number;
}

function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

// Wrong codes typed for an address that belongs to no one are counted too,
// per request, so the answers look exactly like a real member's: "wrong" with
// the same tries left, then "too many", and a fresh request starts over.
async function strangerAttempt(
  env: AuthEnv,
  email: string,
  requestId: string,
  now: Date,
): Promise<CheckOutcome> {
  const bucket = await hash(env, 'stranger-attempts', `${email}:${requestId}`);
  await withinHourlyLimit(env.PLATFORM_DB, bucket, ATTEMPTS_PER_CODE, now);
  const row = await env.PLATFORM_DB.prepare(
    'SELECT sum(count) AS attempts FROM rate_limits WHERE bucket = ?',
  )
    .bind(bucket)
    .first<{ attempts: number | null }>();
  const attempts = row?.attempts ?? 1;
  return attempts >= ATTEMPTS_PER_CODE
    ? { kind: 'too_many' }
    : { kind: 'wrong', triesLeft: ATTEMPTS_PER_CODE - attempts };
}

/**
 * Check a typed code for the person the email belongs to. `requestId` names
 * the request this browser made (from its sign-in step cookie), so an address
 * that belongs to no one is answered the same way a member's is.
 */
export async function checkCode(
  env: AuthEnv,
  input: {
    email: string;
    code: string;
    purpose: CodePurpose;
    requestId: string;
    personId?: string;
    now?: Date;
  },
): Promise<CheckOutcome> {
  const now = input.now ?? new Date();
  const email = normalizeEmail(input.email);
  const personId =
    input.personId ??
    (
      await env.PLATFORM_DB.prepare('SELECT id FROM people WHERE email = ? AND deleted_at IS NULL')
        .bind(email)
        .first<{ id: string }>()
    )?.id;
  if (!personId) return strangerAttempt(env, email, input.requestId, now);

  const row = await env.PLATFORM_DB.prepare(
    `SELECT id, person_id, code_hash, new_email, expires_at, attempts FROM sign_in_codes
     WHERE person_id = ? AND purpose = ? AND used_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(personId, input.purpose)
    .first<CodeRow>();
  if (!row) return { kind: 'expired' };
  if (row.attempts >= ATTEMPTS_PER_CODE) return { kind: 'too_many' };
  if (new Date(row.expires_at) <= now) return { kind: 'expired' };

  const typed = input.code.replaceAll(/\D/g, '');
  if (!sameHash(await hash(env, 'code', typed), row.code_hash)) {
    const attempts = row.attempts + 1;
    await env.PLATFORM_DB.prepare(
      'UPDATE sign_in_codes SET attempts = ?, updated_at = ? WHERE id = ?',
    )
      .bind(attempts, now.toISOString(), row.id)
      .run();
    return attempts >= ATTEMPTS_PER_CODE
      ? { kind: 'too_many' }
      : { kind: 'wrong', triesLeft: ATTEMPTS_PER_CODE - attempts };
  }
  await env.PLATFORM_DB.prepare('UPDATE sign_in_codes SET used_at = ?, updated_at = ? WHERE id = ?')
    .bind(now.toISOString(), now.toISOString(), row.id)
    .run();
  return { kind: 'ok', personId: row.person_id, newEmail: row.new_email };
}

/** The new address waiting for its code, for the confirm step's page. */
export async function pendingNewEmail(
  env: AuthEnv,
  personId: string,
  now: Date = new Date(),
): Promise<string | null> {
  const row = await env.PLATFORM_DB.prepare(
    `SELECT new_email, expires_at FROM sign_in_codes
     WHERE person_id = ? AND purpose = 'confirm_email' AND used_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(personId)
    .first<{ new_email: string | null; expires_at: string }>();
  return row && new Date(row.expires_at) > now ? row.new_email : null;
}

/** Whether a sign-in link can still be used, without using it. */
export async function linkIsLive(
  env: AuthEnv,
  token: string,
  purpose: CodePurpose,
  now: Date = new Date(),
): Promise<boolean> {
  const row = await env.PLATFORM_DB.prepare(
    `SELECT expires_at, attempts FROM sign_in_codes
     WHERE link_token_hash = ? AND purpose = ? AND used_at IS NULL`,
  )
    .bind(await hash(env, 'link', token), purpose)
    .first<Pick<CodeRow, 'expires_at' | 'attempts'>>();
  return Boolean(row && row.attempts < ATTEMPTS_PER_CODE && new Date(row.expires_at) > now);
}

/** Use the link from the email. Works on any device, once. */
export async function useLink(
  env: AuthEnv,
  token: string,
  purpose: CodePurpose,
  now: Date = new Date(),
): Promise<{ kind: 'ok'; personId: string; newEmail: string | null } | { kind: 'expired' }> {
  const row = await env.PLATFORM_DB.prepare(
    `SELECT id, person_id, new_email, expires_at, attempts FROM sign_in_codes
     WHERE link_token_hash = ? AND purpose = ? AND used_at IS NULL`,
  )
    .bind(await hash(env, 'link', token), purpose)
    .first<CodeRow>();
  if (!row || row.attempts >= ATTEMPTS_PER_CODE || new Date(row.expires_at) <= now) {
    return { kind: 'expired' };
  }
  await env.PLATFORM_DB.prepare('UPDATE sign_in_codes SET used_at = ?, updated_at = ? WHERE id = ?')
    .bind(now.toISOString(), now.toISOString(), row.id)
    .run();
  return { kind: 'ok', personId: row.person_id, newEmail: row.new_email };
}

export interface SessionPerson {
  id: string;
  givenName: string | null;
  email: string | null;
  preferredLanguage: string;
  membershipStatus: 'member' | 'former_member' | 'not_member';
}

export interface Session {
  personId: string;
  type: 'member' | 'staff';
  expiresAt: Date;
  /** The fields pages commonly need, read in the same query as the session. */
  person: SessionPerson;
}

function sessionExpiry(type: 'member' | 'staff', from: Date): Date {
  return type === 'member'
    ? new Date(from.getTime() + MEMBER_SESSION_DAYS * 24 * 60 * MINUTE)
    : new Date(from.getTime() + STAFF_SESSION_HOURS * 60 * MINUTE);
}

/** Start a session and return the identifier for the cookie. */
export async function createSession(
  env: AuthEnv,
  personId: string,
  type: 'member' | 'staff',
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = sessionExpiry(type, now);
  const stamp = now.toISOString();
  await env.PLATFORM_DB.prepare(
    `INSERT INTO sessions (id_hash, person_id, type, created_at, last_used_at, expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      await hash(env, 'session', token),
      personId,
      type,
      stamp,
      stamp,
      expiresAt.toISOString(),
      stamp,
    )
    .run();
  // Recording that the person proved they own this address.
  await env.PLATFORM_DB.prepare(
    'UPDATE people SET email_verified_at = coalesce(email_verified_at, ?), updated_at = ? WHERE id = ?',
  )
    .bind(stamp, stamp, personId)
    .run();
  return { token, expiresAt };
}

interface SessionRow {
  person_id: string;
  type: 'member' | 'staff';
  last_used_at: string;
  expires_at: string;
  given_name: string | null;
  email: string | null;
  preferred_language: string;
  membership_status: SessionPerson['membershipStatus'];
}

/**
 * The live session for a cookie value, or null. A member session is extended
 * to 30 days from now, at most once an hour.
 */
export async function readSession(
  env: AuthEnv,
  token: string,
  now: Date = new Date(),
): Promise<Session | null> {
  const idHash = await hash(env, 'session', token);
  const row = await env.PLATFORM_DB.prepare(
    `SELECT s.person_id, s.type, s.last_used_at, s.expires_at, p.given_name, p.email,
       p.preferred_language, p.membership_status
     FROM sessions s
     JOIN people p ON p.id = s.person_id AND p.deleted_at IS NULL
     WHERE s.id_hash = ?`,
  )
    .bind(idHash)
    .first<SessionRow>();
  if (!row || new Date(row.expires_at) <= now) return null;
  let expiresAt = new Date(row.expires_at);
  if (
    row.type === 'member' &&
    now.getTime() - new Date(row.last_used_at).getTime() >= SESSION_TOUCH_MS
  ) {
    expiresAt = sessionExpiry('member', now);
    await env.PLATFORM_DB.prepare(
      'UPDATE sessions SET last_used_at = ?, expires_at = ?, updated_at = ? WHERE id_hash = ?',
    )
      .bind(now.toISOString(), expiresAt.toISOString(), now.toISOString(), idHash)
      .run();
  }
  return {
    personId: row.person_id,
    type: row.type,
    expiresAt,
    person: {
      id: row.person_id,
      givenName: row.given_name,
      email: row.email,
      preferredLanguage: row.preferred_language,
      membershipStatus: row.membership_status,
    },
  };
}

export async function endSession(env: AuthEnv, token: string): Promise<void> {
  await env.PLATFORM_DB.prepare('DELETE FROM sessions WHERE id_hash = ?')
    .bind(await hash(env, 'session', token))
    .run();
}

export async function endAllSessions(env: AuthEnv, personId: string): Promise<void> {
  await env.PLATFORM_DB.prepare('DELETE FROM sessions WHERE person_id = ?').bind(personId).run();
}
