import {
  newsletterEmailKey,
  newsletterIntents,
  newsletterConfirmedTargets,
  finishNewsletterIntent,
  confirmNewsletterTargets,
  type NewsletterWriteIntent,
} from '@lasvegasfortransit/platform-storage/newsletter-work';
import type { BeehiivSubscriptionResult } from './beehiiv-subscriptions';
import type { BeehiivSubscription } from './beehiiv';
import type { BeehiivReconciliation, BeehiivSyncResult } from './beehiiv-sync-context';

export interface NewsletterTarget {
  key: string;
  id?: string;
  email?: string;
  intent?: NewsletterWriteIntent;
}
interface Step {
  subscription: BeehiivSubscription | null;
  intent?: NewsletterWriteIntent;
  email?: string;
  desired: 'active' | 'inactive';
}
type StepResult = { done: true; step: Step } | { done: false; result: BeehiivSyncResult };

export async function newsletterTargets(
  context: BeehiivReconciliation,
): Promise<NewsletterTarget[]> {
  const { db, plan, lease } = context;
  const intents = await newsletterIntents(db, plan, lease.publicationId),
    items = new Map<string, NewsletterTarget>();
  for (const intent of intents) {
    const key = intent.subscriptionId ? `id:${intent.subscriptionId}` : intent.accountKey;
    items.set(key, {
      key,
      ...(intent.subscriptionId ? { id: intent.subscriptionId } : {}),
      intent,
    });
  }
  for (const identity of plan.identities) {
    const key = `id:${identity.externalId}`;
    if (!items.has(key)) items.set(key, { key, id: identity.externalId });
  }
  if (plan.email) {
    const key = await newsletterEmailKey(plan.email);
    if (!items.has(key)) items.set(key, { key, email: plan.email });
  }
  const confirmed = await newsletterConfirmedTargets(db, plan, lease, context.now());
  return [...items.values()].filter((target) => !confirmed.has(target.key));
}
async function targetEmail(
  context: BeehiivReconciliation,
  target: NewsletterTarget,
): Promise<string | null> {
  if (target.email) return target.email;
  const intent = target.intent;
  if (!intent?.encryptedEmail) return null;
  try {
    const email = await context.cipher.decrypt(intent.encryptedEmail, intent);
    return (await newsletterEmailKey(email)) === intent.accountKey ? email : null;
  } catch {
    return null;
  }
}
async function observe(
  context: BeehiivReconciliation,
  target: NewsletterTarget,
): Promise<StepResult> {
  if (!validTargetId(target.id))
    return { done: false, result: await context.outcome('needs_review', 'identity_conflict') };
  const email = target.id ? null : await targetEmail(context, target);
  let observed: BeehiivSubscriptionResult;
  if (target.id) observed = await context.client.getById(target.id);
  else if (email) observed = await context.client.getByEmail(email);
  else return { done: false, result: await context.outcome('needs_review', 'unknown') };
  if (!observed.ok) return { done: false, result: await context.failed(observed) };
  const subscription = observed.subscription;
  if (subscription && !(await context.remember(subscription, target.intent)))
    return { done: false, result: context.stale() };
  if (!(await context.current())) return { done: false, result: context.stale() };
  if (subscription && (await context.conflict(subscription)))
    return { done: false, result: await context.outcome('needs_review', 'identity_conflict') };
  const desired = targetDesired(context, subscription?.email ?? email);
  return {
    done: true,
    step: {
      subscription,
      desired,
      ...(email ? { email } : {}),
      ...(target.intent ? { intent: target.intent } : {}),
    },
  };
}
function validTargetId(id: string | undefined): boolean {
  return !id || /^sub_[A-Za-z0-9_-]{1,124}$/.test(id);
}
function targetDesired(
  context: BeehiivReconciliation,
  email: string | null,
): 'active' | 'inactive' {
  return context.plan.desired === 'active' &&
    email?.toLowerCase() === context.plan.email?.toLowerCase()
    ? 'active'
    : 'inactive';
}
async function grant(context: BeehiivReconciliation, step: Step): Promise<StepResult> {
  if (step.subscription?.status === 'active') return { done: true, step };
  if (!context.plan.allowActivation)
    return {
      done: false,
      result: await context.outcome('needs_review', 'consent_evidence_needed'),
    };
  if (step.subscription && step.subscription.status !== 'inactive')
    return { done: false, result: await context.outcome('needs_review', 'unknown') };
  const address = context.plan.email;
  if (!address) return { done: false, result: context.stale() };
  const intent = step.intent ?? (await context.prepare(address));
  if (!intent) return { done: false, result: context.stale() };
  if (!(await context.authorizeWrite(intent))) return { done: false, result: context.stale() };
  const activated = await context.client.activate(address);
  if (!activated.ok) return { done: false, result: await context.failed(activated) };
  const subscription = activated.subscription;
  if (
    !subscription ||
    !(await context.remember(subscription, intent)) ||
    !(await context.current())
  )
    return { done: false, result: context.stale() };
  if (await context.conflict(subscription))
    return { done: false, result: await context.outcome('needs_review', 'identity_conflict') };
  return { done: true, step: { ...step, subscription, intent } };
}
async function revoke(context: BeehiivReconciliation, step: Step): Promise<StepResult> {
  const { subscription, intent } = step;
  if (!subscription && intent?.writeStartedAt && !intent.subscriptionId)
    return { done: false, result: await context.outcome('retry', 'unknown') };
  if (!subscription || subscription.status === 'inactive') return { done: true, step };
  if ((await context.conflict(subscription)) || !(await context.authorizeRemoval(subscription)))
    return { done: false, result: context.stale() };
  const removed = await context.client.deactivate(subscription.id);
  if (!removed.ok) return { done: false, result: await context.failed(removed) };
  return (await context.current())
    ? { done: true, step }
    : { done: false, result: context.stale() };
}
async function confirm(
  context: BeehiivReconciliation,
  target: NewsletterTarget,
  step: Step,
): Promise<BeehiivSyncResult | null> {
  if (step.desired === 'active' && step.subscription) {
    const result = await context.attach(step.subscription);
    if (result) return result;
  }
  const { db, plan, lease } = context;
  if (
    step.intent &&
    !(await finishNewsletterIntent(db, plan, lease, { intent: step.intent, now: context.now() }))
  )
    return context.stale();
  const keys = new Set([target.key, ...(step.subscription ? [`id:${step.subscription.id}`] : [])]);
  if (
    plan.email &&
    (step.subscription?.email ?? step.email)?.toLowerCase() === plan.email.toLowerCase()
  )
    keys.add(await newsletterEmailKey(plan.email));
  const saved = await confirmNewsletterTargets(db, plan, lease, {
    keys: [...keys],
    desired: step.desired,
    now: context.now(),
  });
  return saved ? null : context.stale();
}
export async function reconcileNewsletterTarget(
  context: BeehiivReconciliation,
  target: NewsletterTarget,
): Promise<BeehiivSyncResult | null> {
  const observed = await observe(context, target);
  if (!observed.done) return observed.result;
  const applied =
    observed.step.desired === 'active'
      ? await grant(context, observed.step)
      : await revoke(context, observed.step);
  return applied.done ? await confirm(context, target, applied.step) : applied.result;
}
