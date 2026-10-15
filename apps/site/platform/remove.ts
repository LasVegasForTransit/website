// "Not you? Remove this email": record withdrawal and provider cleanup,
// then delete the person if joining was their only LVBT history.

import { nowIso } from '@lasvegasfortransit/platform-core/ids';
import { verifyToken } from '@lasvegasfortransit/platform-core/signing';
import type { PlatformEnv } from './join';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';

export type RemovalCheck = { kind: 'valid'; personId: string; email: string } | { kind: 'invalid' };

export async function checkRemovalToken(env: PlatformEnv, token: string): Promise<RemovalCheck> {
  const payload = await verifyToken(env.LVBT_LINK_SIGNING_SECRET, token, 'remove_email');
  if (!payload) return { kind: 'invalid' };
  const person = await new PersonService(env.PLATFORM_DB).getExactPerson(payload.subject);
  if (!person?.email) return { kind: 'invalid' };
  return { kind: 'valid', personId: payload.subject, email: person.email };
}

export async function removeEmail(
  env: PlatformEnv,
  token: string,
): Promise<'removed' | 'invalid' | 'unavailable'> {
  const check = await checkRemovalToken(env, token);
  if (check.kind === 'invalid') {
    const payload = await verifyToken(env.LVBT_LINK_SIGNING_SECRET, token, 'remove_email');
    if (!payload) return 'invalid';
    // Mail clients can repeat a successful one-click request. Acknowledging the
    // original erased subject must never withdraw a new owner's consent.
    const erased = await env.PLATFORM_DB.prepare(
      'SELECT 1 FROM person_keys WHERE id=? AND erased_at IS NOT NULL',
    )
      .bind(payload.subject)
      .first();
    return erased ? 'removed' : 'invalid';
  }
  const people = new PersonService(env.PLATFORM_DB);
  await people.withdrawConsent(check.personId, {
    scope: 'newsletter',
    source: 'removal_link',
    withdrawnAt: nowIso(),
  });
  if (!(await people.getExactPerson(check.personId))) return 'invalid';

  if (!(await people.hasOtherHistory(check.personId))) {
    await people.deletePerson(check.personId, { requireActiveSubject: true });
    const erased = await env.PLATFORM_DB.prepare(
      'SELECT 1 FROM person_keys WHERE id=? AND erased_at IS NOT NULL',
    )
      .bind(check.personId)
      .first();
    if (!erased) return 'invalid';
  }
  return 'removed';
}
