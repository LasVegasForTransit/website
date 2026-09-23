// Matching rules, version 1: deciding whether an incoming record belongs to
// someone LVBT already knows, is someone new, or needs a staff member to
// decide. The rules run in order and the first that applies decides. Two
// existing people are never combined here; that only happens through the
// review queue and a staff decision. See person-service.md, "Matching".

import type { Db } from './db';
import { normalizeEmail } from './field-ownership';
import type { PersonFields, Source } from './person-service';

export type ReviewReason = 'same email, unverified' | 'same phone' | 'same name and ZIP code';

/**
 * Sources where the person typed their own email address into a form. A
 * matching email from one of these is attached to the existing record, filling
 * only empty fields, because the form shows nothing about that record back.
 * Emails that came from someone else, such as a paper sheet, an import or
 * staff entry, get the strict rule instead.
 */
export const SELF_REPORTED_SOURCES: readonly Source[] = [
  'join_form',
  'newsletter_box',
  'google_form',
  'external_form',
  'member',
];

export type IdentityPlatform =
  'beehiiv' | 'notion_intake' | 'google_workspace' | 'discord' | 'givebutter' | 'luma';

export interface IncomingRecord {
  source: Source;
  fields: PersonFields;
  /** The source has shown the person controls this email address. */
  emailVerified?: boolean;
  /** The account on another platform this record came from, if any. */
  identity?: { platform: IdentityPlatform; externalId: string; externalEmail?: string };
}

export type MatchDecision =
  | {
      kind: 'existing';
      personId: string;
      via: 'identity' | 'verified_email' | 'self_reported_email';
    }
  | {
      kind: 'new';
      /** The incoming email belongs to someone else, so the new person can't store it. */
      withholdEmail: boolean;
      review: { existingPersonId: string; reason: ReviewReason }[];
    };

async function personForIdentity(db: Db, incoming: IncomingRecord): Promise<string | null> {
  if (!incoming.identity) return null;
  const row = await db
    .prepare(
      `SELECT i.person_id AS personId FROM identities i
       JOIN people p ON p.id = i.person_id AND p.deleted_at IS NULL
       WHERE i.platform = ? AND i.external_id = ?`,
    )
    .bind(incoming.identity.platform, incoming.identity.externalId)
    .first<{ personId: string }>();
  return row?.personId ?? null;
}

async function similarPeople(
  db: Db,
  fields: PersonFields,
): Promise<{ existingPersonId: string; reason: ReviewReason }[]> {
  const review: { existingPersonId: string; reason: ReviewReason }[] = [];
  if (fields.phone) {
    const { results } = await db
      .prepare('SELECT id FROM people WHERE phone = ? AND deleted_at IS NULL LIMIT 5')
      .bind(fields.phone)
      .all<{ id: string }>();
    for (const { id } of results) review.push({ existingPersonId: id, reason: 'same phone' });
  }
  const given = fields.given_name?.trim();
  const family = fields.family_name?.trim();
  if (given && family && fields.zip) {
    const { results } = await db
      .prepare(
        `SELECT id FROM people WHERE lower(given_name) = lower(?) AND lower(family_name) = lower(?)
         AND zip = ? AND deleted_at IS NULL LIMIT 5`,
      )
      .bind(given, family, fields.zip)
      .all<{ id: string }>();
    for (const { id } of results) {
      review.push({ existingPersonId: id, reason: 'same name and ZIP code' });
    }
  }
  return review;
}

export async function decideMatch(db: Db, incoming: IncomingRecord): Promise<MatchDecision> {
  // Rule 1: the platform account is already linked to someone.
  const linked = await personForIdentity(db, incoming);
  if (linked) return { kind: 'existing', personId: linked, via: 'identity' };

  // Rules 2 and 3: the same normalized email address. Dots and plus signs
  // are kept, because "j.doe" and "jdoe" can be two different people.
  const email = incoming.fields.email ? normalizeEmail(incoming.fields.email) : null;
  if (email) {
    const existing = await db
      .prepare(
        `SELECT id, email_verified_at AS verifiedAt FROM people
         WHERE email = ? AND deleted_at IS NULL`,
      )
      .bind(email)
      .first<{ id: string; verifiedAt: string | null }>();
    if (existing) {
      if (incoming.emailVerified === true || existing.verifiedAt) {
        return { kind: 'existing', personId: existing.id, via: 'verified_email' };
      }
      if (SELF_REPORTED_SOURCES.includes(incoming.source)) {
        return { kind: 'existing', personId: existing.id, via: 'self_reported_email' };
      }
      return {
        kind: 'new',
        withholdEmail: true,
        review: [{ existingPersonId: existing.id, reason: 'same email, unverified' }],
      };
    }
  }

  // Rules 4 and 5: someone new, flagged for review if they look like someone.
  return { kind: 'new', withholdEmail: false, review: await similarPeople(db, incoming.fields) };
}

/**
 * Put a new person and each look-alike in the review queue. A pair is queued
 * once per reason, and never again once staff kept them separate.
 */
export async function queueForReview(
  db: Db,
  candidatePersonId: string,
  decision: Extract<MatchDecision, { kind: 'new' }> & { details: Record<string, string> | null },
  now: string,
): Promise<void> {
  const { review, details } = decision;
  for (const item of review) {
    const keptSeparate = await db
      .prepare(
        `SELECT 1 AS found FROM review_queue WHERE reason = ? AND resolution = 'kept_separate'
         AND ((candidate_person_id = ? AND existing_person_id = ?)
           OR (candidate_person_id = ? AND existing_person_id = ?))`,
      )
      .bind(
        item.reason,
        candidatePersonId,
        item.existingPersonId,
        item.existingPersonId,
        candidatePersonId,
      )
      .first();
    if (keptSeparate) continue;
    await db
      .prepare(
        `INSERT INTO review_queue (id, candidate_person_id, existing_person_id, reason, details, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (candidate_person_id, existing_person_id, reason) DO NOTHING`,
      )
      .bind(
        crypto.randomUUID(),
        candidatePersonId,
        item.existingPersonId,
        item.reason,
        details ? JSON.stringify(details) : null,
        now,
        now,
      )
      .run();
  }
}

/** How an identity came to be linked, for the identities table. */
export function linkMethodFor(
  decision: MatchDecision,
): 'verified_email' | 'self_linked' | 'created_by_platform' {
  if (decision.kind === 'new' || decision.via === 'identity') return 'created_by_platform';
  return decision.via === 'verified_email' ? 'verified_email' : 'self_linked';
}
