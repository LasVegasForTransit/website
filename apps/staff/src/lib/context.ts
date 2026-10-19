import { messageResponse } from './responses';
import {
  discordProviderConfiguration,
  type DiscordRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/discord-runtime';
import {
  googleProviderConfiguration,
  googleGroupInventoryConfiguration,
  type GoogleGroupInventoryRuntime,
  type GoogleAccessRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/google-runtime';
import type { AccessConfiguration } from '@lasvegasfortransit/platform-core/access';
import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import { SESSION_COOKIE, readCookie } from '@lasvegasfortransit/platform-core/web-auth';
import { can } from '@lasvegasfortransit/platform-core/permissions';
import type {
  AccessEnv,
  AccessIdentity,
} from '@lasvegasfortransit/platform-integrations/access-identity';
import type { GoogleSignInEnv } from '@lasvegasfortransit/platform-integrations/google-sign-in';
import { readWorkspaceSession } from '@lasvegasfortransit/platform-storage/workspace-link';
import { loadActor } from '@lasvegasfortransit/platform-storage/staff-roles';
import { auditDenied } from '@lasvegasfortransit/platform-storage/audits';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
export interface StaffEnv
  extends GoogleSignInEnv, AccessEnv, DiscordRuntimeEnv, GoogleAccessRuntimeEnv {
  LVBT_RESEND_API_KEY?: string;
  LVBT_NEWSLETTER_JOBS?: { fetch(request: Request): Promise<Response> };
  /** Set only for the one-time, maintainer-approved first administrator bootstrap. */
  LVBT_INITIAL_STAFF_ADMIN_WORKSPACE_EMAIL?: string;
}
export interface StaffContext {
  actor: Actor;
  db: Db;
  requestId: string;
  newsletterJobs?: { fetch(request: Request): Promise<Response> };
  accessConfiguration?: AccessConfiguration;
  googleGroups?: GoogleGroupInventoryRuntime;
}
export interface StaffLocals {
  staff?: StaffContext;
  access?: AccessIdentity;
}
function staffRoute(actor: Actor, request: Request): 'allowed' | 'paper_home' | 'denied' {
  if (can(actor, 'console.enter')) return 'allowed';
  if (!actor.workspaceLinked || !can(actor, 'attendance.record')) return 'denied';
  const path = new URL(request.url).pathname.replace(/\/$/, '');
  if (path === '' && request.method === 'GET') return 'paper_home';
  return ['/paper', '/paper/sheet', '/sign-out'].includes(path) ? 'allowed' : 'denied';
}
export async function resolveStaffContext(
  request: Request,
  env: StaffEnv,
  access: AccessIdentity,
): Promise<StaffContext | Response> {
  const token = readCookie(request, SESSION_COOKIE);
  const session = token ? await readWorkspaceSession(env, token) : null;
  if (session?.workspaceEmail !== access.email)
    return new Response(null, {
      status: 303,
      headers: {
        Location: `/sign-in/?next=${encodeURIComponent(new URL(request.url).pathname + new URL(request.url).search)}`,
      },
    });
  const actor = await loadActor(env.PLATFORM_DB, session.personId);
  const route = actor ? staffRoute(actor, request) : 'denied';
  if (route === 'paper_home')
    return new Response(null, { status: 303, headers: { Location: '/paper/' } });
  if (!actor || route === 'denied') {
    if (actor) await auditDenied(env.PLATFORM_DB, actor.personId, 'console.enter');
    return messageResponse("You don't have access to this", 403);
  }
  return {
    actor,
    db: env.PLATFORM_DB,
    requestId: crypto.randomUUID(),
    ...(env.LVBT_NEWSLETTER_JOBS ? { newsletterJobs: env.LVBT_NEWSLETTER_JOBS } : {}),
    googleGroups: googleGroupInventoryConfiguration(env),
    accessConfiguration: {
      google_workspace: googleProviderConfiguration(env),
      discord: discordProviderConfiguration(env),
    },
  };
}
