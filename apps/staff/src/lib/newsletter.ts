import type { Page, MutationResult } from '@lasvegasfortransit/platform-core/staff-types';
import type {
  NewsletterReviewRow,
  NewsletterReviewRef,
  NewsletterReviewDetail,
} from '@lasvegasfortransit/platform-storage/newsletter-reviews';
import { consumeFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import type { StaffContext } from './context';
import { field } from './forms';
import { messageResponse } from './responses';
export class NewsletterReviewUnavailable extends Error {
  constructor(readonly status: number) {
    super('Newsletter follow-up is unavailable. Please try again.');
  }
}
async function call<T>(staff: StaffContext, input: Record<string, unknown>): Promise<T> {
  if (!staff.newsletterJobs) throw new NewsletterReviewUnavailable(503);
  const response = await staff.newsletterJobs.fetch(
    new Request('https://jobs.internal/newsletter/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, actorId: staff.actor.personId }),
    }),
  );
  if (!response.ok) throw new NewsletterReviewUnavailable(response.status);
  const value: unknown = await response.json();
  return value as T;
}
export function newsletterPath(ref: NewsletterReviewRef): string {
  return `/newsletter/${ref.kind}/${encodeURIComponent(ref.id)}/?revision=${ref.revision}`;
}
export function newsletterReason(value: string | null): string {
  const reasons: Record<string, string> = {
    unlinked_account: 'We couldn’t match this email subscription to a member record.',
    choice_order_unknown:
      'The mailing list and member record disagree. Confirm what this person wants before changing their record.',
    ownership_changed: 'The email account changed. Check that you’re looking at the right person.',
    ownership_conflict:
      'The email account may belong to another person. Check the member records before continuing.',
    consent_evidence_needed: 'We need a recorded signup before adding this person as a member.',
    source_time_conflict:
      'We couldn’t tell which email preference came last. Confirm the person’s current choice.',
    possible_platform_echo:
      'Check the person’s current email preference before changing their member record.',
    previously_removed_address:
      'This email was previously removed. Ask the person to sign up again if they want to rejoin.',
  };
  return value && Object.hasOwn(reasons, value)
    ? (reasons[value] ?? 'Confirm this person’s current email preference.')
    : 'Confirm this person’s current email preference.';
}
export function newsletterReviews(staff: StaffContext, cursor?: string) {
  return call<Page<NewsletterReviewRow>>(staff, { action: 'list', ...(cursor ? { cursor } : {}) });
}
export function newsletterDetail(staff: StaffContext, ref: NewsletterReviewRef) {
  return call<NewsletterReviewDetail>(staff, { action: 'detail', ref });
}
export async function newsletterDecision(
  request: Request,
  staff: StaffContext,
  ref: NewsletterReviewRef,
): Promise<Response> {
  const form = await request.formData();
  if (
    !(await consumeFormToken(staff.db, staff.actor, {
      action: `newsletter:${ref.kind}:${ref.id}:${ref.revision}`,
      token: field(form, 'token', 43),
    }))
  )
    return messageResponse(
      'This form expired or was already submitted. Reload newsletter follow-up.',
      409,
    );
  const decision = field(form, 'decision', 30);
  try {
    const result = await call<MutationResult<{ personId: string }>>(staff, {
      action: 'resolve',
      ref,
      decision,
      version: field(form, 'version', 43),
      operationId: field(form, 'operation_id', 200),
      note: field(form, 'note', 2000),
    });
    if (result.kind !== 'ok')
      return messageResponse(
        'This record changed. Reload newsletter follow-up before trying again.',
        409,
      );
    return new Response(null, { status: 303, headers: { Location: '/newsletter/?saved=1' } });
  } catch (error) {
    if (!(error instanceof NewsletterReviewUnavailable)) throw error;
    return messageResponse(
      error.status === 409
        ? 'This record changed. Reload newsletter follow-up before trying again.'
        : error.message,
      error.status,
    );
  }
}
