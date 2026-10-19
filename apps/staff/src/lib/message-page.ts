import { createHash } from 'node:crypto';

import { recoveryBrandStyles, recoveryLightLogo, recoveryDarkLogo } from './recovery-brand-data';

// Use the normal staff CSS, font and marks even when the database or asset gateway fails.
export const messagePageStyles = `${recoveryBrandStyles}
*{box-sizing:border-box;border-radius:0}body,h1,p{margin:0}body{min-height:100svh;font-size:var(--text-body-md);line-height:var(--text-body-md--line-height)}
.staff-recovery .container-page{max-width:76rem}.staff-recovery .staff-header-inner{grid-template-columns:1fr}.staff-identity-mark svg{display:block;width:100%;height:100%}.staff-logo-dark{display:none}
.staff-recovery-copy{max-width:60ch}.staff-recovery-actions{display:flex;flex-wrap:wrap;gap:.75rem;margin-block:1.5rem}a{color:inherit;text-underline-offset:.25em}
.staff-recovery-copy p{margin-top:1rem}.staff-recovery-footer{padding-bottom:2rem;font-size:var(--text-body-sm);color:var(--color-on-surface-variant)}
.staff-action-link:hover{background:var(--color-primary-warm);border-color:var(--color-primary-warm)}.staff-secondary-button:hover{background:var(--color-surface-container)}
@media(max-width:40rem){.staff-main{padding-top:2rem}.staff-page-heading{grid-template-columns:minmax(0,1fr)}.staff-recovery-actions{align-items:stretch;flex-direction:column}.staff-recovery-actions a{align-self:start}}
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
      : { href: '/', label: 'Return to staff home' };
  const title =
    status >= 500
      ? 'Staff tools are temporarily unavailable'
      : status === 403
        ? 'You can’t open this page'
        : status === 404
          ? 'This page isn’t available'
          : 'This step needs your attention';
  const detail =
    status >= 500
      ? 'Please come back later. If you were saving a change, check its status when staff tools return before submitting it again.'
      : escapeHtml(
          message || 'Return to staff home to find the page you need, or contact LVBT for help.',
        );
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${title} · LVBT staff</title><style>${messagePageStyles}</style></head>
<body class="staff-shell staff-recovery"><header class="staff-header"><div class="container-page staff-header-inner"><a class="staff-identity" href="/" aria-label="LVBT staff home"><span class="staff-identity-mark staff-logo-light" aria-hidden="true">${recoveryLightLogo}</span><span class="staff-identity-mark staff-logo-dark" aria-hidden="true">${recoveryDarkLogo.replaceAll('clip0_1_687', 'dark_clip0_1_687').replaceAll('clip1_1_687', 'dark_clip1_1_687').replaceAll('clip2_1_687', 'dark_clip2_1_687')}</span><span>Staff</span></a></div></header>
<main id="main" class="container-page staff-main"><div class="staff-page-heading"><div class="staff-heading-copy"><h1>${title}</h1></div></div><div class="staff-recovery-copy"><p>${detail}</p><nav class="staff-recovery-actions" aria-label="Next steps"><a class="staff-action-link" href="${back.href}">${back.label}</a><a class="staff-secondary-button" href="mailto:hello@lasvegasfortransit.org">Contact LVBT</a></nav><p>You can still visit the LVBT website for public events and updates.</p><a class="staff-muted-link" href="https://lasvegasfortransit.org/">Visit the LVBT website</a></div></main>
<footer class="container-page staff-recovery-footer">Las Vegans for Better Transit</footer></body></html>`;
}
