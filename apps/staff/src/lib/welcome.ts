import { can } from '@lasvegasfortransit/platform-core/permissions';
import { ulid } from '@lasvegasfortransit/platform-core/ids';
import { WELCOME_METHODS } from '@lasvegasfortransit/platform-core/welcome';
import { WelcomeService } from '@lasvegasfortransit/platform-storage/welcome';
import { consumeFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import type { StaffContext } from './context';
import { STAFF_PERSON_SCOPE } from '@lasvegasfortransit/platform-storage/staff-scope';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { field } from './forms';
import { privateResponse } from './responses';
export const METHOD_LABELS = {
  email: 'Email',
  phone: 'Phone',
  discord: 'Discord',
  in_person: 'In person',
};
export function welcomeVisible(staff: StaffContext): boolean {
  return can(staff.actor, 'welcome.view');
}
export function welcomeName(person: {
  givenName: string | null;
  familyName: string | null;
}): string {
  return [person.givenName, person.familyName].filter(Boolean).join(' ') || 'Name not recorded';
}
export async function fullProfileAllowed(
  db: Db,
  actorId: string,
  personId: string,
): Promise<boolean> {
  return Boolean(
    await db
      .prepare(
        `SELECT 1 FROM people p WHERE p.id=? AND p.deleted_at IS NULL AND ${STAFF_PERSON_SCOPE}`,
      )
      .bind(personId, actorId)
      .first(),
  );
}
function welcomeFailure(message: string, status: number): Response {
  const text = message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return privateResponse(
    new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Welcome follow-up · LVBT staff</title></head><body><main><h1>Welcome follow-up</h1><p role="alert">${text}</p><a href="/welcome/">Back to welcome members</a></main></body></html>`,
      { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    ),
  );
}
export async function welcomeAction(
  request: Request,
  staff: StaffContext,
  personId: string,
  kind: 'claim' | 'release' | 'complete',
): Promise<Response> {
  const form = await request.formData();
  if (
    !(await consumeFormToken(staff.db, staff.actor, {
      action: `welcome:${kind}:${personId}`,
      token: field(form, 'token', 43),
    }))
  )
    return welcomeFailure(
      'This form expired or was already submitted. Reload the page and try again.',
      409,
    );
  const service = new WelcomeService(staff.db);
  const input = { operationId: field(form, 'operation_id', 200) || ulid() };
  const method = field(form, 'method', 20);
  if (kind === 'complete' && !WELCOME_METHODS.some((allowed) => allowed === method))
    return welcomeFailure('Choose how you welcomed this member.', 400);
  const outcome =
    kind === 'complete'
      ? await service.complete(staff.actor, personId, {
          ...input,
          method: method as (typeof WELCOME_METHODS)[number],
          note: field(form, 'note', 2001),
        })
      : await service[kind](staff.actor, personId, input);
  if (outcome.kind === 'forbidden') return welcomeFailure("You don't have access to this", 403);
  if (outcome.kind === 'invalid')
    return welcomeFailure(
      'Check the welcome method and keep the note under 2,000 characters.',
      400,
    );
  if (outcome.kind !== 'ok')
    return welcomeFailure('This welcome has changed. Go back to the list and try again.', 409);
  return new Response(null, {
    status: 303,
    headers: { Location: kind === 'claim' ? `/welcome/${personId}/` : '/welcome/' },
  });
}
