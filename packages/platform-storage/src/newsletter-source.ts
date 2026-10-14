import { ulid } from '@lasvegasfortransit/platform-core/ids';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import type { Db } from './db';
import { loadNewsletterSourceContext, type NewsletterSourceInput } from './newsletter-source-plan';
import { decideNewsletterSource } from './newsletter-source-choice';
import { resolveNewsletterSourcePerson } from './newsletter-source-person';
import { newsletterSourceStatements } from './newsletter-source-write';
export type { NewsletterSourceInput } from './newsletter-source-plan';

export interface NewsletterSourceResult {
  kind: 'applied' | 'ignored' | 'needs_review' | 'already_processed' | 'stale';
  personId?: string;
}

/** Apply only saved, authenticated evidence; ownership, choice and replay share one transaction. */
export async function applyNewsletterSourceEvent(
  db: Db,
  input: NewsletterSourceInput,
): Promise<NewsletterSourceResult> {
  const loaded = await loadNewsletterSourceContext(db, input);
  if (!loaded || !Number.isFinite(input.now.getTime())) return { kind: 'stale' };
  const { context, snapshot } = loaded;
  if (context.event.state !== 'pending') return { kind: 'already_processed' };
  if (Date.parse(context.event.occurred_at) > input.now.getTime()) return { kind: 'stale' };
  const address = input.email.trim().toLowerCase();
  if (context.event.email_key !== `email:${await digestToken(address)}`) return { kind: 'stale' };
  const decision = decideNewsletterSource(context, address);
  const person = await resolveNewsletterSourcePerson(db, { context, address, decision });
  if (!person) return { kind: 'stale' };
  const nonce = ulid(),
    stamp = input.now.toISOString();
  await db.batch(
    newsletterSourceStatements(db, {
      input,
      context,
      snapshot,
      address,
      decision,
      person,
      nonce,
      stamp,
    }),
  );
  const saved = await db
    .prepare('SELECT 1 FROM newsletter_source_operations WHERE nonce=?')
    .bind(nonce)
    .first();
  if (!saved) return { kind: 'stale' };
  return person.personId
    ? { kind: decision.kind, personId: person.personId }
    : { kind: decision.kind };
}
