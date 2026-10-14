import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import type { ProviderConfiguration } from '@lasvegasfortransit/platform-core/access';
import { GOOGLE_GROUP_QUERY, googleGroupQueryParameters } from './google-group-query';
export interface GoogleGroupAction {
  groupEmail: string;
  personId: string;
  identityId: string;
  expectedSnapshot: string;
  expectedAccess: boolean;
  operationId: string;
  configuration: ProviderConfiguration;
  consoleGroupEmail: string | null;
}
export function validGoogleGroupAction(input: GoogleGroupAction, now: Date): boolean {
  return (
    /^[\w:-]{1,120}$/.test(input.operationId) &&
    /^[A-Za-z0-9_-]{1,128}$/.test(input.identityId) &&
    input.groupEmail.length <= 254 &&
    /^[a-z0-9][a-z0-9._+-]*@lasvegasfortransit\.org$/.test(input.groupEmail) &&
    /^[0-9A-HJKMNP-TV-Z]{26}$/.test(input.personId) &&
    input.expectedSnapshot.length <= 512 &&
    typeof input.expectedAccess === 'boolean' &&
    Number.isFinite(now.getTime())
  );
}
export function googleGroupActionGuard(actor: Actor, input: GoogleGroupAction, now: Date) {
  return {
    sql: `EXISTS(${GOOGLE_GROUP_QUERY} SELECT 1 FROM summaries s JOIN differences d ON d.group_email=s.group_email
    WHERE s.group_email=? AND s.state='current' AND NOT s.is_console
    AND json_array(s.group_id,s.content_hash,s.started_at)=? AND d.person_id=? AND d.identity_id=? AND d.state=?)`,
    values: [
      ...googleGroupQueryParameters(actor, {
        configuration: input.configuration,
        consoleGroupEmail: input.consoleGroupEmail,
        now,
      }),
      input.groupEmail,
      input.expectedSnapshot,
      input.personId,
      input.identityId,
      input.expectedAccess ? 'missing' : 'unexpected',
    ],
  };
}
