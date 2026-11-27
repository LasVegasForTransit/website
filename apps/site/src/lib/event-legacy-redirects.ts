/**
 * Redirects retired historical `/events/<slug>` paths from `public/_redirects`
 * so runtime `run_worker_first` routing preserves the same 301 contract.
 */
export const EVENT_LEGACY_REDIRECTS: Readonly<Record<string, string>> = {
  '2026-07-09-lvbt-general-member-meeting': '/events/2026-07-16-lvbt-general-member-meeting/',
  '2026-07-11-lvbt-s-first-walk-audit-tbd': '/events/2026-07-11-lvbt-s-first-walk-audit/',
  '2026-10-15-vegas-urbanists': '/events/2026-10-15-vegas-urbanist-social-club/',
  '2026-12-17-vegas-urbanists': '/events/2026-12-17-vegas-urbanist-social-club/',
  '2027-01-21-vegas-urbanists': '/events/2027-01-21-vegas-urbanist-social-club/',
  '2027-02-18-vegas-urbanists': '/events/2027-02-18-vegas-urbanist-social-club/',
  '2027-03-18-vegas-urbanists': '/events/2027-03-18-vegas-urbanist-social-club/',
  '2027-04-15-vegas-urbanists': '/events/2027-04-15-vegas-urbanist-social-club/',
  '2027-05-20-vegas-urbanists': '/events/2027-05-20-vegas-urbanist-social-club/',
  '2027-06-17-vegas-urbanists': '/events/2027-06-17-vegas-urbanist-social-club/',
  '2027-07-15-vegas-urbanists': '/events/2027-07-15-vegas-urbanist-social-club/',
  '2027-08-19-vegas-urbanists': '/events/2027-08-19-vegas-urbanist-social-club/',
  '2027-09-16-vegas-urbanists': '/events/2027-09-16-vegas-urbanist-social-club/',
};
