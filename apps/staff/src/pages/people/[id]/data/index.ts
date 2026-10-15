import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { can } from '@lasvegasfortransit/platform-core/permissions';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { hashWithSecret } from '@lasvegasfortransit/platform-core/signing';
import { readCookie, SESSION_COOKIE } from '@lasvegasfortransit/platform-core/web-auth';
import { collectPersonExport } from '@lasvegasfortransit/platform-storage/person-export';
import { messageResponse, privateResponse } from '../../../../lib/responses';
import type { StaffEnv } from '../../../../lib/context';

export const GET: APIRoute = async ({ request, locals, params }) => {
  const staff = locals.staff;
  const workspaceEmail = locals.access?.email;
  const token = readCookie(request, SESSION_COOKIE);
  if (!staff || !can(staff.actor, 'export.full') || !workspaceEmail || !token)
    return messageResponse(t('staff.common.accessDenied'), 403);
  const data = await collectPersonExport(staff.db, params.id ?? '', {
    kind: 'administrator',
    personId: staff.actor.personId,
    workspaceEmail,
    sessionHash: await hashWithSecret(
      (env as unknown as StaffEnv).LVBT_SIGN_IN_SECRET,
      `session:${token}`,
    ),
  });
  if (!data) return messageResponse(t('staff.common.accessDenied'), 403);
  return privateResponse(
    new Response(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="lvbt-member-data-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    }),
  );
};
