import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { rosterObject } from './roster-evidence';
import {
  type PersonService,
  ImportedMatchNeedsReview,
} from '@lasvegasfortransit/platform-storage/person-service';
import type {
  ClassifiedRecord,
  RosterImportApplyResult,
  RosterImportSource,
} from './roster-classification';

/** Apply shared matching once, retaining an uncertain source without a second profile. */
export async function upsertRosterPerson(
  people: PersonService,
  record: ClassifiedRecord & { source: RosterImportSource; sourceId: string; email: string },
) {
  try {
    return await people.upsertFromSource({
      source: 'import',
      holdUnverifiedEmail: true,
      fields: { email: record.email, ...record.profile.fields },
      identity: {
        platform: record.source,
        externalId: record.sourceId,
        externalEmail: record.email,
      },
    });
  } catch (error) {
    if (!(error instanceof ImportedMatchNeedsReview)) throw error;
    const held: RosterImportApplyResult['records'][number] = {
      index: record.index,
      status: 'needs_review',
      suggestedPersonId: error.personId,
      reasons: ['identity_match_unconfirmed'],
    };
    return { held };
  }
}

/** A confirmed original response need not reconstruct absent history for a known roll member. */
export async function knownRollResponse(
  db: Db,
  record: ClassifiedRecord,
  context: {
    person: { id: string; membership_status: string };
    input: unknown;
  },
): Promise<boolean> {
  if (
    record.source !== 'notion_intake' ||
    context.person.membership_status !== 'member' ||
    record.classification !== 'unresolved' ||
    !record.reasons.every((reason) => reason === 'consent_unclear')
  )
    return false;
  const input = rosterObject(context.input),
    newsletter = rosterObject(input.newsletter),
    form = rosterObject(input.form);
  if (
    newsletter.state !== 'unknown' ||
    form.membershipAffirmative != null ||
    [newsletter.answer, newsletter.givenAt, newsletter.withdrawnAt, form.affirmativeAnswer].some(
      (value) => value != null && value !== '',
    )
  )
    return false;
  return Boolean(
    await db
      .prepare(
        'SELECT 1 FROM membership_roll WHERE person_id=? AND entitled=1 AND review_reason IS NULL',
      )
      .bind(context.person.id)
      .first(),
  );
}
