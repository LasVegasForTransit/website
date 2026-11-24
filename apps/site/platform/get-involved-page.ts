/// <reference types="@cloudflare/workers-types" />

// Fills the account page's Get involved section: the member's applications
// (one row each, with Withdraw for waiting ones) and the teams taking new members. Values
// from the database are escaped; class lists match src/components/app/styles.ts.

import { formatDate, t } from '@lasvegasfortransit/platform-core/messages';
import { escapeHtml } from '@lasvegasfortransit/platform-integrations/email';
import {
  RESPONSE_DAYS,
  type MemberApplication,
  type OpenCommittee,
} from '@lasvegasfortransit/platform-storage/committee-applications';
import { show } from '../functions/join/_page';

const ROW =
  'grid gap-x-6 gap-y-2 border-t border-on-surface/15 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center';
const META = 'text-sm';
const LINK = 'font-bold underline underline-offset-4 decoration-2 decoration-primary';
// Withdraw reads like the row's other actions ("Ask to join"): a text button
// with the full 44px target, not a boxed button competing with the row.
const TEXT_BUTTON = `${LINK} inline-flex min-h-11 items-center text-sm cursor-pointer`;

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

interface Step {
  label: string;
  detail: string;
  state: 'done' | 'current' | 'next';
}

// Sent, then the lead's review, then the decision. A withdrawn application
// keeps its one-line status instead.
function applicationSteps(application: MemberApplication): Step[] {
  const sent: Step = {
    label: t('applications.stepSent'),
    detail: day(application.submittedAt),
    state: 'done',
  };
  if (application.state === 'submitted')
    return [
      sent,
      {
        label: t('applications.stepReview'),
        detail: t('applications.replyBy', { date: formatDate(replyDue(application.submittedAt)) }),
        state: 'current',
      },
      { label: t('applications.stepDecision'), detail: '', state: 'next' },
    ];
  const decided = day(application.decidedAt ?? application.submittedAt);
  return [
    sent,
    { label: t('applications.stepReview'), detail: '', state: 'done' },
    {
      label:
        application.state === 'accepted'
          ? t('applications.stepAccepted')
          : t('applications.stepDeclined'),
      detail: decided,
      state: 'done',
    },
  ];
}

const STEP_CLASS: Record<Step['state'], string> = {
  done: 'border-on-surface',
  current: 'border-primary',
  next: 'border-on-surface/20 text-on-surface-variant',
};

function stepper(application: MemberApplication): string {
  const items = applicationSteps(application).map((step) => {
    const status =
      step.state === 'next'
        ? ''
        : step.state === 'done'
          ? t('applications.stepDone')
          : t('applications.stepCurrent');
    return `<li class="border-t-4 pt-2 ${STEP_CLASS[step.state]}"${step.state === 'current' ? ' aria-current="step"' : ''}><span class="block font-bold">${escapeHtml(step.label)}</span>${
      step.detail ? `<span class="block">${escapeHtml(step.detail)}</span>` : ''
    }${status ? `<span class="sr-only">, ${escapeHtml(status)}</span>` : ''}</li>`;
  });
  return `<ol class="${META} mt-3 grid max-w-md grid-cols-3 gap-2" aria-label="${escapeHtml(t('applications.progress'))}">${items.join('')}</ol>`;
}

/** What the application is for: the role, or the team for an ask to join. */
export function applicationTitle(application: MemberApplication): string {
  return application.roleTitle ?? application.committeeName ?? '';
}

function applicationRow(application: MemberApplication): string {
  const title = escapeHtml(applicationTitle(application));
  const team =
    application.roleTitle && application.committeeName
      ? ` <span class="font-normal">· ${escapeHtml(application.committeeName)}</span>`
      : '';
  const note =
    application.decisionNote && application.state !== 'withdrawn'
      ? `<p class="${META} mt-1">“${escapeHtml(application.decisionNote)}”</p>`
      : '';
  const withdraw =
    application.state === 'submitted'
      ? `<form method="post" action="/account/applications/withdraw/" class="sm:self-start"><input type="hidden" name="id" value="${escapeHtml(application.id)}" /><button type="submit" class="${TEXT_BUTTON}">${escapeHtml(t('applications.withdraw'))}<span class="sr-only"> ${escapeHtml(t('applications.withdrawFor', { title: applicationTitle(application) }))}</span></button></form>`
      : '';
  return `<li class="${ROW}"><div class="min-w-0"><p class="font-bold">${title}${team}</p>${
    application.state === 'withdrawn'
      ? `<p class="${META}">${escapeHtml(t('applications.withdrawn', { date: day(application.decidedAt ?? application.submittedAt) }))}</p>`
      : stepper(application)
  }${note}</div>${withdraw}</li>`;
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
    ? `<p class="${META}">${escapeHtml(t('applications.onTeam'))}</p>`
    : pending
      ? `<p class="${META}">${escapeHtml(
          t('applications.pendingTeam', {
            date: day(pending.submittedAt),
            due: formatDate(replyDue(pending.submittedAt)),
          }),
        )}</p>`
      : `<a href="/account/apply/?team=${encodeURIComponent(committee.id)}" class="${LINK} text-sm">${escapeHtml(t('applications.askToJoin'))}</a>`;
  return `<li class="${ROW}"><div class="min-w-0"><p class="font-bold">${escapeHtml(committee.name)}</p>${
    details ? `<p class="${META}">${escapeHtml(details)}</p>` : ''
  }</div>${action}</li>`;
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
