import { site } from './site';

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
