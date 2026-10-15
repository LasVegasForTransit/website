import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import {
  newsletterPause,
  pauseNewsletter,
} from '@lasvegasfortransit/platform-storage/newsletter-work';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { loadActor } from '@lasvegasfortransit/platform-storage/staff-roles';
import {
  listNewsletterReviews,
  newsletterReview,
  resolveNewsletterReview,
  type NewsletterReviewRef,
  validReviewRef,
} from '@lasvegasfortransit/platform-storage/newsletter-reviews';
import {
  beehiivRuntime,
  type BeehiivRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/beehiiv-runtime';
import { BeehiivSubscriptions } from '@lasvegasfortransit/platform-integrations/beehiiv-subscriptions';
import { NewsletterEventCipher } from '@lasvegasfortransit/platform-integrations/newsletter-event-cipher';
import { readNewsletterBody } from '@lasvegasfortransit/platform-integrations/beehiiv-event-receiver';
import { queryBudget } from '@lasvegasfortransit/platform-storage/query-budget';
import { PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';
import { InvalidCursor } from '@lasvegasfortransit/platform-storage/staff-history';

interface Input {
  actorId: string;
  action: 'list' | 'detail' | 'resolve';
  cursor?: string;
  ref?: NewsletterReviewRef;
  decision?: 'unsubscribe' | 'recorded_choice';
  version?: string;
  operationId?: string;
  note?: string;
}
function response(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
function reviewRef(value: unknown): NewsletterReviewRef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return validReviewRef(value as NewsletterReviewRef) ? (value as NewsletterReviewRef) : null;
}
function resolution(
  actorId: string,
  v: Record<string, unknown>,
  ref: NewsletterReviewRef,
): Input | null {
  if (
    !['unsubscribe', 'recorded_choice'].includes(String(v.decision)) ||
    typeof v.version !== 'string' ||
    typeof v.operationId !== 'string' ||
    typeof v.note !== 'string'
  )
    return null;
  return {
    actorId,
    action: 'resolve',
    ref,
    decision: v.decision as NonNullable<Input['decision']>,
    version: v.version,
    operationId: v.operationId,
    note: v.note,
  };
}
function parse(value: unknown): Input | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.actorId !== 'string' ||
    v.actorId.length > 100 ||
    !['list', 'detail', 'resolve'].includes(String(v.action))
  )
    return null;
  if (v.action === 'list')
    return {
      actorId: v.actorId,
      action: 'list',
      ...(typeof v.cursor === 'string' ? { cursor: v.cursor } : {}),
    };
  const ref = reviewRef(v.ref);
  if (!ref) return null;
  return v.action === 'detail'
    ? { actorId: v.actorId, action: 'detail', ref }
    : resolution(v.actorId, v, ref);
}
async function reviewAddress(
  db: Db,
  item: NonNullable<Awaited<ReturnType<typeof newsletterReview>>>,
  options: { publicationId: string; intentKey: string; provider: BeehiivSubscriptions },
): Promise<string | null> {
  const { publicationId, intentKey, provider } = options;
  if (item.email) return item.email;
  let email: string | null = null;
  if (item.encryptedEmail && item.emailKey)
    email = await new NewsletterEventCipher(intentKey).decrypt(item.encryptedEmail, {
      publicationId,
      id: item.id,
      subscriptionId: item.subscriptionId,
      emailKey: item.emailKey,
    });
  if (!email) {
    if (await newsletterPause(db, publicationId, new Date()))
      throw new Error('Provider unavailable');
    const result = await provider.getById(item.subscriptionId);
    if (!result.ok) {
      if (result.retryAfterMs)
        await pauseNewsletter(db, publicationId, result.retryAfterMs, new Date());
      throw new Error('Provider unavailable');
    }
    email = result.subscription?.email ?? null;
  }
  return email;
}
async function detail(
  db: Db,
  input: Input,
  options: { publicationId: string; intentKey: string; provider: BeehiivSubscriptions },
) {
  const { publicationId } = options;
  const actor = await loadActor(db, input.actorId);
  if (!actor?.staffAdmin || actor.membershipStatus !== 'member')
    return response({ kind: 'forbidden' }, 403);
  if (!input.ref) return response({ kind: 'invalid' }, 400);
  const item = await newsletterReview(db, actor, publicationId, input.ref);
  if (!item) return response({ kind: 'not_found' }, 404);
  const email = await reviewAddress(db, item, options);
  const fresh = await newsletterReview(db, actor, publicationId, input.ref);
  if (!fresh) return response({ kind: 'forbidden' }, 403);
  if (fresh.version !== item.version) return response({ kind: 'conflict' }, 409);
  return response({ ...item, email, encryptedEmail: undefined, emailKey: undefined });
}
type ResolutionInput = Input &
  Required<Pick<Input, 'ref' | 'decision' | 'version' | 'operationId' | 'note'>>;
function isResolution(input: Input): input is ResolutionInput {
  return Boolean(
    input.ref && input.decision && input.version && input.operationId && input.note !== undefined,
  );
}
async function dispatch(context: {
  db: Db;
  actor: Actor;
  input: Input;
  runtime: NonNullable<ReturnType<typeof beehiivRuntime>>;
  options: { fetcher?: typeof fetch };
}) {
  const { db, actor, input, runtime, options } = context;
  const publicationId = runtime.configuration.publicationId;
  if (input.action === 'list')
    return response(
      await listNewsletterReviews(db, actor, publicationId, {
        ...(input.cursor ? { cursor: input.cursor } : {}),
      }),
    );
  if (input.action === 'detail')
    return await detail(db, input, {
      publicationId,
      intentKey: runtime.intentKey,
      provider: new BeehiivSubscriptions(runtime.configuration, options),
    });
  if (!isResolution(input)) return response({ kind: 'invalid' }, 400);
  const result = await resolveNewsletterReview(db, actor, publicationId, {
    ...input.ref,
    action: input.decision,
    version: input.version,
    operationId: input.operationId,
    note: input.note,
    now: new Date(),
  });
  return response(result, result.kind === 'ok' ? 200 : result.kind === 'forbidden' ? 403 : 409);
}
export async function handleNewsletterReviewRequest(
  request: Request,
  env: BeehiivRuntimeEnv & { PLATFORM_DB: Db },
  options: { fetcher?: typeof fetch } = {},
): Promise<Response> {
  if (request.method !== 'POST' || request.url !== 'https://jobs.internal/newsletter/review')
    return response({ kind: 'not_found' }, 404);
  if (request.headers.get('Content-Type') !== 'application/json')
    return response({ kind: 'invalid' }, 400);
  try {
    const bytes = await readNewsletterBody(request),
      input = bytes ? parse(JSON.parse(new TextDecoder().decode(bytes)) as unknown) : null;
    if (!input) return response({ kind: 'invalid' }, 400);
    const db = queryBudget(env.PLATFORM_DB, 50).db,
      actor = await loadActor(db, input.actorId);
    if (!actor?.staffAdmin || actor.membershipStatus !== 'member')
      return response({ kind: 'forbidden' }, 403);
    // Staff can inspect and resolve saved differences while outgoing work is disabled.
    const runtime = beehiivRuntime({ ...env, LVBT_BEEHIIV_SYNC_ENABLED: 'true' });
    if (!runtime) return response({ kind: 'unavailable' }, 503);
    return await dispatch({ db, actor, input, runtime, options });
  } catch (error) {
    return response(
      { kind: 'unavailable' },
      error instanceof PermissionDenied
        ? 403
        : error instanceof InvalidCursor || error instanceof SyntaxError
          ? 400
          : 503,
    );
  }
}
