/// <reference types="@cloudflare/workers-types" />

// /account: everything LVBT holds about the signed-in member, with a way to
// change each part. Sends a signed-out visitor to sign in and back.

import { accountView } from '../../platform/account';
import { formatPhone } from '@lasvegasfortransit/platform-core/join-form';
import { formatDate, formatFullDate, t } from '@lasvegasfortransit/platform-core/messages';
import { show, showEmailText, showText } from '../join/_page';
import type { SignInPagesEnv } from '../sign-in/_shared';
import { accountPage, signedIn, takeNotice } from './_account';
import { discordLinkConfigured } from '@lasvegasfortransit/platform-integrations/discord-link';
import { DiscordLinkService } from '@lasvegasfortransit/platform-storage/discord-link';
import { SESSION_COOKIE, readCookie } from '@lasvegasfortransit/platform-core/web-auth';
import { fillDiscordProfile } from '../../platform/discord-profile-page';
import { applicationTitle, fillGetInvolved, replyDue } from '../../platform/get-involved-page';
import {
  CommitteeApplicationService,
  type MemberApplication,
} from '@lasvegasfortransit/platform-storage/committee-applications';

// The notices a redirect can leave for this page, by the id in the cookie.
const NOTICES: Record<string, () => string> = {
  signed_in: () => t('signIn.signedIn'),
  discord_connected: () => t('discord.connectedNotice'),
  discord_disconnected: () => t('discord.disconnected'),
  discord_cancelled: () => t('discord.cancelled'),
  name: () => t('account.updated.name'),
  phone: () => t('account.updated.phone'),
  email: () => t('account.updated.email'),
  area: () => t('account.updated.area'),
  area_placed: () => t('account.updated.areaPlaced'),
  left: () => t('account.updated.left'),
  rejoined: () => t('account.updated.rejoined'),
  unavailable: () => t('account.unavailable'),
  application_duplicate: () => t('applications.duplicate'),
  application_on_team: () => t('applications.alreadyOnTeam'),
  application_closed: () => t('applications.closed'),
  application_not_member: () => t('applications.notMember'),
  application_unknown: () => t('applications.unknown'),
};

/** The notice text. "Sent" and "Withdrawn" name the application they are about. */
function noticeText(key: string | null, applications: MemberApplication[]): string | undefined {
  if (key === 'application_sent') {
    // The application just sent is the newest waiting one.
    const latest = applications.find((entry) => entry.state === 'submitted');
    return t('applications.sent', {
      due: latest ? formatDate(replyDue(latest.submittedAt)) : '',
    });
  }
  if (key === 'application_withdrawn') {
    const latest = applications
      .filter((entry) => entry.state === 'withdrawn')
      .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))[0];
    return latest
      ? t('applications.withdrawnNotice', { title: applicationTitle(latest) })
      : undefined;
  }
  return key && Object.hasOwn(NOTICES, key) ? NOTICES[key]?.() : undefined;
}

export const onRequestGet: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  const view = await accountView(signed.env.PLATFORM_DB, signed.person.id);
  if (!view) return new Response(null, { status: 303, headers: { Location: '/sign-in/' } });
  const { person } = view;
  const notice = takeNotice(request);
  const name = [person.given_name, person.family_name].filter(Boolean).join(' ');
  const connectedDiscord = discordLinkConfigured(env)
    ? await new DiscordLinkService(signed.env).profile(readCookie(request, SESSION_COOKIE) ?? '')
    : null;
  const discord =
    person.membership_status === 'member' || connectedDiscord?.linked ? connectedDiscord : null;
  const applications = new CommitteeApplicationService(signed.env.PLATFORM_DB);
  const getInvolved =
    person.membership_status === 'member'
      ? {
          applications: await applications.forPerson(signed.person.id),
          committees: await applications.openCommittees(),
          onCommittees: await applications.memberCommittees(signed.person.id),
        }
      : null;
  const text = noticeText(notice.key, getInvolved?.applications ?? []);

  return accountPage(env, request, '/account/', {
    fill: (rewriter) => {
      let filled = fillDiscordProfile(rewriter, discord);
      if (getInvolved) filled = fillGetInvolved(filled, getInvolved);
      if (person.membership_status !== 'member')
        filled = filled.on('[data-slot="discord-manage"]', {
          element(element) {
            element.remove();
          },
        });
      if (person.given_name) {
        filled = filled.on(
          '[data-slot="greeting"]',
          showText(t('account.greetingNamed', { name: person.given_name })),
        );
      }
      if (name) filled = filled.on('[data-slot="name"]', showText(name));
      if (person.email) filled = filled.on('[data-slot="email"]', showEmailText(person.email));
      if (person.phone) {
        filled = filled.on('[data-slot="phone"]', showText(formatPhone(person.phone)));
      }
      if (view.area) filled = filled.on('[data-slot="area"]', showText(view.area));
      if (view.onMailingList) {
        filled = filled
          .on(
            '[data-slot="member-since"]',
            showText(
              view.memberSince
                ? t('account.memberSince', { date: formatFullDate(new Date(view.memberSince)) })
                : t('account.member'),
            ),
          )
          .on('[data-slot="mailing-list"]', show());
        filled = filled.on('[data-slot="member-check"]', show());
      } else {
        filled = filled
          .on('[data-slot="rejoin"]', show())
          .on('[data-slot="membership-inactive"]', show());
      }
      if (text) filled = filled.on('[data-slot="notice"]', showText(text));
      return filled;
    },
    status: 200,
    headers: notice.clear,
  });
};
