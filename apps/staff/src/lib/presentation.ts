const LABELS: Record<string, string> = {
  newsletter: 'Mailing list',
  event_reminders: 'Event reminders',
  volunteer_contact: 'Volunteer follow-up',
  join_form: 'LVBT signup form',
  newsletter_box: 'Website signup',
  google_form: 'Google signup form',
  external_form: 'Signup form',
  account: 'Member account',
  member: 'Member',
  staff: 'LVBT staff',
  paper: 'Paper signup',
  check_in: 'Event check-in',
  import: 'Imported member list',
  beehiiv: 'Mailing list',
  google_workspace: 'LVBT Google account',
  discord: 'Discord',
  givebutter: 'Givebutter donations',
  luma: 'Luma events',
  notion_intake: 'Signup form',
  checkbox: 'Signup checkbox',
  double_opt_in: 'Confirmed by email',
  paper_signature: 'Signed on paper',
  unknown: 'Method not recorded',
  self_linked: 'Confirmed by the member',
  staff_confirmed: 'Confirmed by LVBT staff',
  created_by_platform: 'Connected automatically',
  subscribed: 'Joined the mailing list',
  unsubscribed: 'Left the mailing list',
  joined: 'Joined LVBT',
  welcomed: 'Welcomed to LVBT',
  rsvp: 'Signed up for an event',
  attended: 'Attended an event',
  donated: 'Made a donation',
  volunteer_shift: 'Volunteered',
  role_changed: 'Committee role changed',
  check_in_held: 'Had a check-in',
  correction: 'Details corrected',
  duplicate_reviewed: 'Possible duplicate checked',
  lead: 'Committee lead',
  stepped_back: 'Stepped back',
  given_name: 'First name',
  family_name: 'Last name',
  email: 'Email',
  phone: 'Phone',
  zip: 'ZIP code',
  census_block: 'Location reference',
  census_block_vintage: 'Location reference year',
  place_name: 'Area',
  preferred_language: 'Preferred language',
};

export function displayLabel(value: string): string {
  if (Object.hasOwn(LABELS, value)) return LABELS[value];
  const words = value.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function languageLabel(value: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(value) ?? value;
  } catch {
    return value;
  }
}
