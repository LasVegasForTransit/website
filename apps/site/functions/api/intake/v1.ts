/// <reference types="@cloudflare/workers-types" />

// POST /api/intake/v1: the versioned intake interface any outside form tool
// uses to add a sign-up. Contract and examples: docs/guides/connect-a-form-tool.md.

import { parseIntake, processIntake } from '../../../platform/intake';
import type { JoinEnv } from '../../join/_page';
import { bearerToken, timingSafeEqual } from '../_shared';

interface Env extends JoinEnv {
  LVBT_MEMBERSHIP_INTAKE_SECRET?: string;
}

function reply(status: number, body: object): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  if (!env.LVBT_MEMBERSHIP_INTAKE_SECRET) {
    console.error('/api/intake/v1: LVBT_MEMBERSHIP_INTAKE_SECRET is missing');
    return reply(503, {
      error: 'not_configured',
      message: 'The intake interface is not set up on this deployment.',
    });
  }
  if (!timingSafeEqual(bearerToken(request), env.LVBT_MEMBERSHIP_INTAKE_SECRET)) {
    return reply(401, {
      error: 'unauthorized',
      message: 'Send the intake token as "Authorization: Bearer <token>".',
    });
  }
  if (!env.PLATFORM_DB) {
    console.error('/api/intake/v1: the PLATFORM_DB binding is missing');
    return reply(503, {
      error: 'not_configured',
      message: 'The intake interface is not set up on this deployment.',
    });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = parseIntake(body);
  if (!parsed.ok) {
    return reply(400, {
      error: 'invalid_fields',
      fields: parsed.fields,
      message:
        'Some fields are missing or not in the expected form. The fields are listed by name.',
    });
  }

  const outcome = await processIntake({ ...env, PLATFORM_DB: env.PLATFORM_DB }, parsed.submission, {
    subscribe: true,
  });
  if (outcome.kind === 'unavailable') {
    return reply(503, {
      error: 'unavailable',
      message: 'The submission could not be completed right now. Send it again in a minute.',
    });
  }
  return reply(200, outcome.response);
};
