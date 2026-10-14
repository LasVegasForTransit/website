import { t } from '@lasvegasfortransit/platform-core/messages';
const LABELS: Record<string, string> = {
  newsletter: t('staff.labels.newsletter'),
  event_reminders: t('staff.labels.event_reminders'),
  volunteer_contact: t('staff.labels.volunteer_contact'),
  join_form: t('staff.labels.join_form'),
  newsletter_box: t('staff.labels.newsletter_box'),
  google_form: t('staff.labels.google_form'),
  external_form: t('staff.labels.external_form'),
  account: t('staff.labels.account'),
  member: t('staff.labels.member'),
  staff: t('staff.labels.staff'),
  paper: t('staff.labels.paper'),
  check_in: t('staff.labels.check_in'),
  import: t('staff.labels.import'),
  beehiiv: t('staff.labels.beehiiv'),
  google_workspace: t('staff.labels.google_workspace'),
  discord: t('staff.labels.discord'),
  givebutter: t('staff.labels.givebutter'),
  luma: t('staff.labels.luma'),
  notion_intake: t('staff.labels.notion_intake'),
  checkbox: t('staff.labels.checkbox'),
  double_opt_in: t('staff.labels.double_opt_in'),
  paper_signature: t('staff.labels.paper_signature'),
  unknown: t('staff.labels.unknown'),
  self_linked: t('staff.labels.self_linked'),
  staff_confirmed: t('staff.labels.staff_confirmed'),
  created_by_platform: t('staff.labels.created_by_platform'),
  subscribed: t('staff.labels.subscribed'),
  unsubscribed: t('staff.labels.unsubscribed'),
  joined: t('staff.labels.joined'),
  welcomed: t('staff.labels.welcomed'),
  rsvp: t('staff.labels.rsvp'),
  attended: t('staff.labels.attended'),
  donated: t('staff.labels.donated'),
  volunteer_shift: t('staff.labels.volunteer_shift'),
  role_changed: t('staff.labels.role_changed'),
  check_in_held: t('staff.labels.check_in_held'),
  correction: t('staff.labels.correction'),
  duplicate_reviewed: t('staff.labels.duplicate_reviewed'),
  lead: t('staff.labels.lead'),
  stepped_back: t('staff.labels.stepped_back'),
  given_name: t('staff.labels.given_name'),
  family_name: t('staff.labels.family_name'),
  email: t('staff.labels.email'),
  phone: t('staff.labels.phone'),
  zip: t('staff.labels.zip'),
  census_block: t('staff.labels.census_block'),
  census_block_vintage: t('staff.labels.census_block_vintage'),
  place_name: t('staff.labels.place_name'),
  preferred_language: t('staff.labels.preferred_language'),
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
