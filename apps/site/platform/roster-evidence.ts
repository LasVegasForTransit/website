import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import type { ConsentMethod } from '@lasvegasfortransit/platform-storage/person-service';
import type { Db } from '@lasvegasfortransit/platform-storage/db';

export function rosterObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown, limit = 2000): string | null {
  return typeof value === 'string' && value.trim() && value.length <= limit ? value.trim() : null;
}
const BEEHIIV_EVIDENCE_FIELDS = [
  'subscriber_id',
  'api_subscription_id',
  'email',
  'tags',
  'status',
  'created_at',
  'updated_at',
  'unsubscribed_at',
  'referred_by',
  'campaign',
  'channel',
  'acquisition_source',
  'referring_url',
  'acquisition_term',
  'acquisition_content',
  'First Name',
  'Last Name',
  'id',
  'utm_source',
  'utm_medium',
  'utm_channel',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'referring_site',
] as const;
export function consentMethod(value: unknown): ConsentMethod {
  return ['checkbox', 'double_opt_in', 'paper_signature'].includes(String(value))
    ? (value as ConsentMethod)
    : 'unknown';
}
/** Retain bounded source facts, never arbitrary provider payloads or credentials. */
export function rosterEvidence(value: unknown): Record<string, unknown> {
  const input = rosterObject(value),
    newsletter = rosterObject(input.newsletter),
    form = rosterObject(input.form);
  return {
    source: text(input.source, 30),
    sourceId: text(input.sourceId, 200),
    email: text(input.email, 254)?.toLowerCase() ?? null,
    givenName: text(input.givenName, 100),
    familyName: text(input.familyName, 100),
    newsletter: {
      state: text(newsletter.state, 30),
      givenAt: text(newsletter.givenAt, 40),
      affirmative: newsletter.affirmative === true,
      method: consentMethod(newsletter.method),
      wordingVersion: text(newsletter.wordingVersion, 200),
      wording: text(newsletter.wording),
      answer: text(newsletter.answer),
      withdrawnAt: text(newsletter.withdrawnAt, 40),
      withdrawnTimeBasis: newsletter.withdrawnTimeBasis === 'observed' ? 'observed' : 'choice',
      observedAt: text(newsletter.observedAt, 40),
      sourceCreatedAt: text(newsletter.sourceCreatedAt, 40),
      evidenceReference: text(newsletter.evidenceReference, 500),
    },
    ...(input.beehiiv
      ? {
          beehiiv: Object.fromEntries(
            BEEHIIV_EVIDENCE_FIELDS.map((key) => [key, text(rosterObject(input.beehiiv)[key])]),
          ),
        }
      : {}),
    ...(input.form
      ? {
          form: {
            submittedAt: text(form.submittedAt, 40),
            sourceSubmittedAt: text(form.sourceSubmittedAt, 200),
            fullName: text(form.fullName, 2000),
            source: text(form.source, 200),
            originalResponseTimestamp: text(form.originalResponseTimestamp, 100),
            originalResponseTimeZone: text(form.originalResponseTimeZone, 100),
            submissionMinute: text(form.submissionMinute, 40),
            membershipAffirmative:
              typeof form.membershipAffirmative === 'boolean' ? form.membershipAffirmative : null,
            affirmativeAnswer: text(form.affirmativeAnswer),
            discordUsername: text(form.discordUsername, 100),
            referral: text(form.referral),
            ...(form.responseId ? { responseId: text(form.responseId, 200) } : {}),
            ...(form.rawResponseUrl ? { rawResponseUrl: text(form.rawResponseUrl, 500) } : {}),
          },
        }
      : {}),
  };
}
export async function rosterReceipt(db: Db, value: unknown) {
  const evidence = rosterEvidence(value),
    encoded = JSON.stringify(evidence),
    hash = await digestToken(encoded);
  const prior = await db
    .prepare(
      'SELECT id,person_id,state FROM roster_import_records WHERE source=? AND source_id=? AND evidence_hash=?',
    )
    .bind(String(evidence.source), String(evidence.sourceId), hash)
    .first<{ id: string; person_id: string | null; state: string }>();
  return { evidence, encoded, hash, prior };
}
