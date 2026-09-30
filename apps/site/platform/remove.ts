// "Not you? Remove this email": withdraw the newsletter consent, unsubscribe
// in Beehiiv, and delete the person if joining was the only thing they ever
// did with LVBT.

import { nowIso } from './core/ids';
import { verifyToken } from './core/signing';
import { unsubscribe } from './integrations/beehiiv';
import type { PlatformEnv } from './join';
import { PersonService } from './storage/person-service';

export type RemovalCheck = { kind: 'valid'; personId: string; email: string } | { kind: 'invalid' };

export async function checkRemovalToken(env: PlatformEnv, token: string): Promise<RemovalCheck> {
  const payload = await verifyToken(env.LVBT_LINK_SIGNING_SECRET, token, 'remove_email');
  if (!payload) return { kind: 'invalid' };
  const person = await new PersonService(env.PLATFORM_DB).getPerson(payload.subject);
  if (!person?.email) return { kind: 'invalid' };
  return { kind: 'valid', personId: person.id, email: person.email };
}

export async function removeEmail(
  env: PlatformEnv,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<'removed' | 'invalid' | 'unavailable'> {
  const check = await checkRemovalToken(env, token);
  if (check.kind === 'invalid') return 'invalid';
  const people = new PersonService(env.PLATFORM_DB);
  const { results } = await env.PLATFORM_DB.prepare(
    "SELECT external_id AS externalId FROM identities WHERE person_id = ? AND platform = 'beehiiv'",
  )
    .bind(check.personId)
    .all<{ externalId: string }>();
  if (results.length && (!env.LVBT_BEEHIIV_API_KEY || !env.LVBT_BEEHIIV_PUBLICATION_ID)) {
    return 'unavailable';
  }
  if (env.LVBT_BEEHIIV_API_KEY && env.LVBT_BEEHIIV_PUBLICATION_ID) {
    for (const { externalId } of results) {
      const stopped = await unsubscribe(
        { apiKey: env.LVBT_BEEHIIV_API_KEY, publicationId: env.LVBT_BEEHIIV_PUBLICATION_ID },
        externalId,
        fetcher,
      );
      if (!stopped) return 'unavailable';
    }
  }

  await people.withdrawConsent(check.personId, {
    scope: 'newsletter',
    source: 'removal_link',
    withdrawnAt: nowIso(),
  });

  if (!(await people.hasOtherHistory(check.personId))) {
    await people.deletePerson(check.personId);
  }
  return 'removed';
}
