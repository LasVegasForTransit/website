/// <reference types="@cloudflare/workers-types" />

// /account/apply: apply for a role posted on /join/ (?role=<slug>) or ask to
// join a team that is taking members (?team=<committee id>). The role list
// comes from the built /join/roles.json, so only roles really on the site can
// be applied for.

import { t } from '@lasvegasfortransit/platform-core/messages';
import {
  AVAILABILITY_LIMIT,
  CommitteeApplicationService,
  NOTE_LIMIT,
  type ApplicationTarget,
} from '@lasvegasfortransit/platform-storage/committee-applications';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { showText } from '../../join/_page';
import { setValue, type SignInPagesEnv } from '../../sign-in/_shared';
import { accountPage, backToAccount, field, formOf, signedIn, type Signed } from '../_account';

interface Resolved {
  target: ApplicationTarget;
  heading: string;
  noteLabel: string;
  submit: string;
}

const SLUG = /^[a-z0-9-]{1,100}$/;

interface Context {
  env: SignInPagesEnv;
  request: Request;
  signed: Signed;
}

async function resolve(
  { env, request, signed }: Context,
  { role, team }: { role: string; team: string },
): Promise<Resolved | null> {
  if (role) {
    if (!SLUG.test(role)) return null;
    const response = await env.ASSETS.fetch(new URL('/join/roles.json', request.url));
    if (!response.ok) return null;
    const roles: Record<string, { title: string; committee: string | null }> =
      await response.json();
    const posted = Object.hasOwn(roles, role) ? roles[role] : undefined;
    if (!posted) return null;
    return {
      target: { committeeId: posted.committee, roleSlug: role, roleTitle: posted.title },
      heading: t('applications.applyRoleTitle', { role: posted.title }),
      noteLabel: t('applications.noteRoleLabel'),
      submit: t('applications.submitRole'),
    };
  }
  if (!team || !SLUG.test(team)) return null;
  const committees = await new CommitteeApplicationService(signed.env.PLATFORM_DB).openCommittees();
  const committee = committees.find((entry) => entry.id === team);
  if (!committee) return null;
  return {
    target: { committeeId: committee.id, roleSlug: null, roleTitle: null },
    heading: t('applications.askTitle', { committee: committee.name }),
    noteLabel: t('applications.noteTeamLabel'),
    submit: t('applications.submitTeam'),
  };
}

async function isMember(signed: Signed): Promise<{ member: boolean; name: string }> {
  const person = await new PersonService(signed.env.PLATFORM_DB).getExactPerson(signed.person.id);
  return {
    member: person?.membership_status === 'member',
    name: [person?.given_name, person?.family_name].filter(Boolean).join(' '),
  };
}

function page(
  { env, request }: Context,
  { resolved, name }: { resolved: Resolved; name: string },
  input: { role: string; team: string; note: string; availability: string; error?: string },
): Promise<Response> {
  return accountPage(env, request, '/account/apply/', {
    status: input.error ? 400 : 200,
    fill: (rewriter) => {
      let filled = rewriter
        .on('title', {
          element(element) {
            element.setInnerContent(`${resolved.heading} | LVBT`);
          },
        })
        .on('h1', showText(resolved.heading))
        .on(
          '[data-slot="intro"]',
          showText(
            name ? t('applications.applyingAs', { name }) : t('applications.applyingAsUnnamed'),
          ),
        )
        .on('[data-slot="note-label"]', showText(resolved.noteLabel))
        .on('form button[type="submit"]', showText(resolved.submit))
        .on('input[name="role"]', setValue(input.role))
        .on('input[name="team"]', setValue(input.team))
        .on('input[name="availability"]', setValue(input.availability))
        .on('textarea[name="note"]', showText(input.note));
      if (input.error) filled = filled.on('[data-slot="notice"]', showText(input.error));
      return filled;
    },
  });
}

export const onRequestGet: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  const url = new URL(request.url);
  const role = url.searchParams.get('role') ?? '';
  const team = role ? '' : (url.searchParams.get('team') ?? '');
  const context = { env, request, signed };
  const resolved = await resolve(context, { role, team });
  if (!resolved) return backToAccount('application_unknown');
  const { member, name } = await isMember(signed);
  if (!member) return backToAccount('application_not_member');
  return page(context, { resolved, name }, { role, team, note: '', availability: '' });
};

export const onRequestPost: PagesFunction<SignInPagesEnv> = async ({ env, request }) => {
  const signed = await signedIn(env, request);
  if (signed instanceof Response) return signed;
  const form = await formOf(request);
  const role = field(form, 'role').slice(0, 100);
  const team = role ? '' : field(form, 'team').slice(0, 100);
  const note = field(form, 'note');
  const availability = field(form, 'availability');
  const context = { env, request, signed };
  const resolved = await resolve(context, { role, team });
  if (!resolved) return backToAccount('application_unknown');
  const { member, name } = await isMember(signed);
  if (!member) return backToAccount('application_not_member');
  if (note.trim().length > NOTE_LIMIT || availability.trim().length > AVAILABILITY_LIMIT) {
    return page(
      context,
      { resolved, name },
      {
        role,
        team,
        note: note.slice(0, NOTE_LIMIT),
        availability: availability.slice(0, AVAILABILITY_LIMIT),
        error: t('applications.tooLong'),
      },
    );
  }
  const outcome = await new CommitteeApplicationService(signed.env.PLATFORM_DB).submit(
    signed.person.id,
    resolved.target,
    { note, availability },
  );
  switch (outcome.kind) {
    case 'ok':
      return backToAccount('application_sent');
    case 'duplicate':
      return backToAccount('application_duplicate');
    case 'already_on_committee':
      return backToAccount('application_on_team');
    case 'unavailable':
      return backToAccount('application_closed');
    case 'invalid':
      return backToAccount('application_unknown');
  }
};
