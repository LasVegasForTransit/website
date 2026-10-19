import { createHash } from 'node:crypto';

import { recoveryBrandStyles, recoveryLightLogo, recoveryDarkLogo } from './recovery-brand-data';

// Use the normal staff CSS, font and marks even when the database or asset gateway fails.
export const messagePageStyles = `${recoveryBrandStyles}
*{box-sizing:border-box;border-radius:0}body,h1,p{margin:0}body{min-height:100svh;font-size:var(--text-body-md);line-height:var(--text-body-md--line-height)}
.staff-recovery{display:grid;place-items:center;padding:clamp(1rem,4vw,3rem)}
.staff-recovery-panel{width:100%;max-width:42rem;padding:clamp(1.5rem,5vw,3rem);background:var(--color-surface-container);border-top:4px solid var(--color-primary);text-align:center}
.staff-recovery .staff-identity{justify-content:center;width:fit-content;margin-inline:auto;margin-bottom:2rem}.staff-identity-mark svg{display:block;width:100%;height:100%}.staff-logo-dark{display:none}
.staff-recovery h1{max-width:22ch;margin-inline:auto;font-size:var(--text-headline-md);font-weight:var(--text-headline-md--font-weight);line-height:var(--text-headline-md--line-height);letter-spacing:var(--text-headline-md--letter-spacing);text-wrap:balance;overflow-wrap:anywhere}
.staff-recovery-detail{max-width:52ch;margin:1.25rem auto 0;text-wrap:pretty}
.staff-recovery-actions{display:flex;justify-content:center;flex-wrap:wrap;gap:.75rem;margin-block:1.75rem 0}.staff-recovery-actions a{max-width:100%;overflow-wrap:anywhere}
a{color:inherit;text-underline-offset:.25em}.staff-recovery-note{max-width:48ch;margin:1rem auto 0;font-size:var(--text-body-sm);color:var(--color-on-surface-variant)}.staff-recovery-help{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:0 .35rem;margin-top:.75rem}.staff-recovery-help a{display:inline-flex;align-items:center;min-height:2.75rem}
.staff-action-link:hover{background:var(--color-primary-warm);border-color:var(--color-primary-warm)}.staff-secondary-button:hover{background:var(--color-surface-container)}
@media(max-width:30rem){.staff-recovery-actions{display:grid;grid-template-columns:minmax(0,1fr)}.staff-recovery .staff-identity{margin-bottom:1.5rem}}
@media(prefers-color-scheme:dark){.staff-logo-light{display:none}.staff-logo-dark{display:block}}

`;
export const messagePageStyleHash = createHash('sha256').update(messagePageStyles).digest('base64');
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
export function messagePage(
  message: string,
  status: number,
  destination: 'home' | 'welcome' = 'home',
): string {
  const back =
    destination === 'welcome'
      ? { href: '/welcome/', label: 'Back to welcome members' }
      : { href: '/', label: status >= 500 ? 'Try again' : 'Return to staff home' };
  const title =
    status >= 500
      ? 'We’re having trouble with staff tools'
      : status === 403
        ? 'You can’t open this page'
        : status === 404
          ? 'This page isn’t available'
          : 'This step needs your attention';
  const detail =
    status >= 500
      ? 'Sorry for the interruption. Please try again in a little while.'
      : escapeHtml(
          message || 'Return to staff home to find the page you need, or contact LVBT for help.',
        );
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${title} · Las Vegans for Better Transit</title><style>${messagePageStyles}</style></head>
<body class="staff-shell staff-recovery"><main id="main" class="staff-recovery-panel"><header><a class="staff-identity" href="/" aria-label="LVBT staff home"><span class="staff-identity-mark staff-logo-light" aria-hidden="true">${recoveryLightLogo}</span><span class="staff-identity-mark staff-logo-dark" aria-hidden="true">${recoveryDarkLogo.replaceAll('clip0_1_687', 'dark_clip0_1_687').replaceAll('clip1_1_687', 'dark_clip1_1_687').replaceAll('clip2_1_687', 'dark_clip2_1_687')}</span><span>Staff</span></a></header>
<h1>${title}</h1><p class="staff-recovery-detail">${detail}</p>${status >= 500 ? '<p class="staff-recovery-note">If you were saving a change, check whether it went through before trying again.</p>' : ''}<nav class="staff-recovery-actions" aria-label="Next steps"><a class="staff-action-link" href="${back.href}">${back.label}</a></nav><p class="staff-recovery-help">Need a hand? <a class="staff-muted-link" href="mailto:hello@lasvegasfortransit.org">Email the team</a></p></main></body></html>`;
}
