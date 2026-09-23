// Where "Become a member" and the /qr Join slide send people. By default it
// is the site's own join form. Setting PUBLIC_LVBT_MEMBERSHIP_FORM_URL to an
// outside form's address (for example the Google Form) switches both links to
// it, with no code change. See docs/reference/membership-intake.md.
import { site } from './site';

const JOIN_PATH = '/join/member';

/** The link target on the site. */
export const membershipUrl = site.membership.formUrl ?? JOIN_PATH;

/** The absolute address, for print and for the QR code. */
export const membershipPrintUrl = site.membership.formUrl ?? `${site.url}${JOIN_PATH}`;

/** How the address reads on the /qr slide. */
export const membershipDisplayUrl = site.membership.formUrl
  ? 'lasvegasfortransit.org/join'
  : 'lasvegasfortransit.org/join/member';
