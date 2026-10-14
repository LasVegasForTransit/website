import { ulid } from '@lasvegasfortransit/platform-core/ids';
import type { Db } from './db';
import { decideMatch } from './matching';
import type { SourceContext } from './newsletter-source-plan';
import type { SourceDecision } from './newsletter-source-choice';

export interface SourcePerson {
  personId: string | null;
  create: boolean;
}
export async function resolveNewsletterSourcePerson(
  db: Db,
  input: { context: SourceContext; address: string; decision: SourceDecision },
): Promise<SourcePerson | null> {
  const { context, address, decision } = input;
  const selected = { personId: context.owner?.id ?? context.candidate?.id ?? null, create: false };
  if (decision.kind !== 'applied' || context.owner) return selected;
  const match = await decideMatch(db, {
    source: 'beehiiv',
    fields: { email: address },
    emailVerified: true,
    identity: {
      platform: 'beehiiv',
      externalId: context.event.subscription_id,
      externalEmail: address,
    },
  });
  if (match.kind === 'existing')
    return match.personId === context.candidate?.id
      ? { personId: match.personId, create: false }
      : null;
  if (context.candidate || match.withholdEmail || match.review.length) return null;
  return { personId: ulid(), create: true };
}
