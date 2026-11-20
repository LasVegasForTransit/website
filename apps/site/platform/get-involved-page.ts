/// <reference types="@cloudflare/workers-types" />

// Fills the account page's Get involved section: the member's applications
// (with Withdraw for waiting ones) and the teams taking new members. Values
// from the database are escaped; class lists match src/components/app/styles.ts.

import { formatDate, t } from '@lasvegasfortransit/platform-core/messages';
import { escapeHtml } from '@lasvegasfortransit/platform-integrations/email';
import {
  RESPONSE_DAYS,
  type MemberApplication,
  type OpenCommittee,
} from '@lasvegasfortransit/platform-storage/committee-applications';
import { show } from '../functions/join/_page';

const ROW = 'border-t border-on-surface/15 py-4';
const META = 'mt-1 text-sm';
const LINK = 'font-bold underline underline-offset-4 decoration-2 decoration-primary';
const SECONDARY =
  'press inline-flex items-center justify-center gap-1.5 px-6 py-3 font-bold border-2 bg-transparent text-on-surface border-on-surface hover:bg-surface-container';

export interface GetInvolved {
  applications: MemberApplication[];
  committees: OpenCommittee[];
  onCommittees: Set<string>;
}

/** When the lead is due to reply to an application sent at `submittedAt`. */
export function replyDue(submittedAt: string): Date {
  return new Date(new Date(submittedAt).getTime() + RESPONSE_DAYS * 86_400_000);
}

function day(iso: string): string {
  return formatDate(new Date(iso));
}

function applicationRow(application: MemberApplication): string {
  const title = escapeHtml(application.roleTitle ?? application.committeeName ?? '');
  const decided = application.decidedAt ?? application.submittedAt;
  const status =
    application.state === 'submitted'
      ? t('applications.submitted', {
          date: day(application.submittedAt),
          due: formatDate(replyDue(application.submittedAt)),
        })
      : application.state === 'accepted'
        ? t('applications.accepted', {
            date: day(decided),
            committee: application.committeeName ?? '',
          })
        : application.state === 'declined'
          ? t('applications.declined', { date: day(decided) })
          : t('applications.withdrawn', { date: day(decided) });
  const note =
    application.decisionNote && application.state !== 'withdrawn'
      ? `<p class="${META}">“${escapeHtml(application.decisionNote)}”</p>`
      : '';
  const withdraw =
    application.state === 'submitted'
      ? `<form method="post" action="/account/applications/withdraw/" class="mt-3"><input type="hidden" name="id" value="${escapeHtml(application.id)}" /><button type="submit" class="${SECONDARY}">${escapeHtml(t('applications.withdraw'))}</button></form>`
      : '';
  return `<li class="${ROW}"><p class="font-bold">${title}</p><p class="${META}">${escapeHtml(status)}</p>${note}${withdraw}</li>`;
}

function teamRow(committee: OpenCommittee, data: GetInvolved): string {
  const details = [committee.timeCommitment, committee.description].filter(Boolean).join(' · ');
  const pending = data.applications.find(
    (application) =>
      application.state === 'submitted' &&
      application.roleSlug === null &&
      application.committeeId === committee.id,
  );
  const action = data.onCommittees.has(committee.id)
    ? `<p class="${META} font-bold">${escapeHtml(t('applications.onTeam'))}</p>`
    : pending
      ? `<p class="${META} font-bold">${escapeHtml(
          t('applications.pendingTeam', {
            date: day(pending.submittedAt),
            due: formatDate(replyDue(pending.submittedAt)),
          }),
        )}</p>`
      : `<a href="/account/apply/?team=${encodeURIComponent(committee.id)}" class="${LINK} mt-2 inline-block">${escapeHtml(t('applications.askToJoin'))}</a>`;
  return `<li class="${ROW}"><p class="font-bold">${escapeHtml(committee.name)}</p>${
    details ? `<p class="${META}">${escapeHtml(details)}</p>` : ''
  }${action}</li>`;
}

function fillList(html: string): HTMLRewriterElementContentHandlers {
  return {
    element(element) {
      element.setInnerContent(html, { html: true });
    },
  };
}

export function fillGetInvolved(rewriter: HTMLRewriter, data: GetInvolved): HTMLRewriter {
  let filled = rewriter
    .on('[data-slot="get-involved"]', show())
    .on('[data-slot="get-involved-nav"]', show());
  if (data.applications.length > 0)
    filled = filled.on(
      '[data-slot="applications-list"]',
      fillList(data.applications.map(applicationRow).join('')),
    );
  if (data.committees.length > 0)
    filled = filled.on(
      '[data-slot="teams-list"]',
      fillList(data.committees.map((committee) => teamRow(committee, data)).join('')),
    );
  return filled;
}
