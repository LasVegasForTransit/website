export const WORKSPACE_DOMAIN = 'lasvegasfortransit.org';

/** Claims supplied only after the server verifies Google's signed ID token. */
export interface WorkspaceIdentity {
  subject: string;
  email: string;
  givenName: string | null;
  familyName: string | null;
}
