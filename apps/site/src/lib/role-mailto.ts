import { site } from './site';

// Builds the "Express interest" mailto link for a team role. Subject and body
// are generated from the role title so every role page produces an identical,
// pre-populated draft — no per-role copy to maintain, no encoding to hand-roll
// in frontmatter. The body gives the applicant a light scaffold matching the
// "send a short note" ask on the page itself.
export function roleApplicationMailto(roleTitle: string): string {
  const subject = `Interest: ${roleTitle}`;
  const body = [
    'Hi LVBT team,',
    '',
    `I'd like to express interest in the ${roleTitle} role.`,
    '',
    'A bit about me:',
    '- Where I’m coming from:',
    '- What draws me to this role:',
    '- Relevant background:',
    '',
    'Thanks!',
  ].join('\n');

  const params = new URLSearchParams({ subject, body });
  // URLSearchParams encodes spaces as "+", which some mail clients don't
  // decode in mailto bodies; "%20" is universally understood.
  return `mailto:${site.email.general}?${params.toString().replace(/\+/g, '%20')}`;
}

// General "not sure where you fit" inquiry — same standardized shape, no role.
export function generalInterestMailto(): string {
  const params = new URLSearchParams({
    subject: 'Getting involved with LVBT',
    body: [
      'Hi LVBT team,',
      '',
      'I’d like to get involved but I’m not sure where I fit yet.',
      '',
      'A bit about me:',
      '',
      'Thanks!',
    ].join('\n'),
  });
  return `mailto:${site.email.general}?${params.toString().replace(/\+/g, '%20')}`;
}
