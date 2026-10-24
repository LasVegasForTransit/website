import { createHash } from 'node:crypto';

import { gatePageStyles, gateIdentity, gateFooter } from './gate-page';

export interface StaffErrorReport {
  reference: string;
  occurredAt: string;
}

export const messagePageStyles = gatePageStyles;
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
  report?: StaffErrorReport,
): string {
  const back =
    destination === 'welcome'
      ? { href: '/welcome/', label: 'Back to welcome members' }
      : { href: '/', label: status >= 500 ? 'Try again' : 'Return to staff home' };
  const title =
    status >= 500
      ? 'Staff tools are unavailable'
      : status === 403
        ? 'You can’t open this page'
        : status === 404
          ? 'This page isn’t available'
          : 'This step needs your attention';
  const detail =
    status >= 500
      ? 'In Discord, share which page failed, what you were trying to do and the reference below.'
      : escapeHtml(
          message || 'Return to staff home to find the page you need, or contact LVBT for help.',
        );
  const actions =
    status >= 500
      ? `<a class="staff-action-link" href="https://discord.com/channels/1509298455896522823">Open Discord</a><a class="staff-secondary-button" href="${back.href}">${back.label}</a>`
      : `<a class="staff-action-link" href="${back.href}">${back.label}</a>`;
  const help =
    status >= 500
      ? ''
      : `<p class="staff-gate-help">Need a hand? <a class="staff-muted-link" href="mailto:hello@lasvegasfortransit.org">Email the team</a></p>`;
  const reportDetails =
    status >= 500 && report
      ? `<p class="staff-gate-report">Reference <strong>${escapeHtml(report.reference)}</strong><time datetime="${escapeHtml(report.occurredAt)}">${escapeHtml(new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'America/Los_Angeles', timeZoneName: 'short' }).format(new Date(report.occurredAt)))}</time></p>`
      : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${title} · Las Vegans for Better Transit</title><style>${messagePageStyles}</style></head>
<body class="staff-shell staff-gate"><a href="#main" class="skip-link">Skip to content</a><div class="staff-gate-frame"><main id="main" class="staff-gate-panel" tabindex="-1"><header>${gateIdentity}</header>
<h1>${title}</h1><p>${detail}</p>${reportDetails}<nav class="staff-gate-actions" aria-label="Next steps">${actions}</nav>${help}</main>${gateFooter}</div></body></html>`;
}
