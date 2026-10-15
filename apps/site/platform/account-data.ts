// A member's data: downloading everything LVBT holds about them, and
// deleting their account. Rendering lives in the site.

import { codeEmail, type AccountEnv, type CodeCheck } from './account';
import { checkCode, endAllSessions, requestCode } from '@lasvegasfortransit/platform-storage/auth';
import { nowIso } from '@lasvegasfortransit/platform-core/ids';
import { formatTime } from '@lasvegasfortransit/platform-core/messages';
import { sendCodeEmail } from './sign-in';
import { collectPersonExport } from '@lasvegasfortransit/platform-storage/person-export';
import { PersonService, type Person } from '@lasvegasfortransit/platform-storage/person-service';

// --- Your data -----------------------------------------------------------

export const exportData = collectPersonExport;

// --- Deleting the account ------------------------------------------------

export async function sendDeleteCode(
  env: AccountEnv,
  person: Pick<Person, 'id' | 'email'>,
  callerAddress: string,
  fetcher: typeof fetch = fetch,
): Promise<{ kind: 'sent' } | { kind: 'rate_limited'; retryAfter: string } | { kind: 'no_email' }> {
  if (!person.email) return { kind: 'no_email' };
  const outcome = await requestCode(env, {
    email: person.email,
    purpose: 'delete_account',
    callerAddress,
    personId: person.id,
  });
  if (outcome.kind === 'rate_limited') {
    return { kind: 'rate_limited', retryAfter: formatTime(outcome.retryAfter) };
  }
  if (outcome.kind === 'issued') {
    await sendCodeEmail(
      env,
      codeEmail(person.email, outcome.issued.code, 'delete_account'),
      fetcher,
    );
  }
  return { kind: 'sent' };
}

/**
 * Check the code and delete the account: off the mailing list, personal
 * details cleared now, signed out everywhere. The retention job removes the
 * row itself within 30 days.
 */
export async function deleteAccount(
  env: AccountEnv,
  person: Pick<Person, 'id' | 'email'>,
  code: string,
): Promise<CodeCheck> {
  const outcome = await checkCode(env, {
    email: '',
    code,
    purpose: 'delete_account',
    requestId: '',
    personId: person.id,
  });
  if (outcome.kind !== 'ok') return outcome;
  const people = new PersonService(env.PLATFORM_DB);
  await people.withdrawConsent(person.id, {
    scope: 'newsletter',
    source: 'account_deleted',
    withdrawnAt: nowIso(),
  });
  await people.deletePerson(person.id);
  await endAllSessions(env, person.id);
  return { kind: 'ok' };
}
