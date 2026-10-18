/// <reference types="@cloudflare/workers-types" />

import { isRecord } from '../../scripts/notion/lib/notion-client';
import { intakeFieldsFromBody } from '../../scripts/notion/lib/intake-page';
import { googleFormSubmission, processIntake } from '../../platform/intake';
import { bearerToken, errorResponse, jsonHeaders, timingSafeEqual } from './_shared';

interface Env {
  PLATFORM_DB?: D1Database;
  LVBT_MEMBERSHIP_INTAKE_SECRET: string;
}
const AUTH_CONFIG = ['LVBT_MEMBERSHIP_INTAKE_SECRET'] as const;
function missingKeys(env: Env, keys: readonly (keyof Env)[]): string[] {
  return keys.filter((key) => !env[key]);
}
function missingConfig(missing: string[]): Response {
  console.error('/api/membership-intake: required configuration is missing', missing);
  return errorResponse('service_unavailable', 503, { missing });
}
export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const authMissing = missingKeys(env, AUTH_CONFIG);
  if (authMissing.length) return missingConfig(authMissing);
  if (!timingSafeEqual(bearerToken(request), env.LVBT_MEMBERSHIP_INTAKE_SECRET))
    return errorResponse('unauthorized', 401);
  if (!env.PLATFORM_DB) return missingConfig(['PLATFORM_DB']);
  const parsed: unknown = await request.json().catch(() => null);
  if (!isRecord(parsed)) return errorResponse('invalid_body', 400);
  const fields = intakeFieldsFromBody(parsed);
  if (!fields) return errorResponse('invalid_email', 400);
  const outcome = await processIntake(
    { PLATFORM_DB: env.PLATFORM_DB },
    googleFormSubmission(fields),
  );
  if (outcome.kind === 'unavailable') return errorResponse('service_unavailable', 503);
  return Response.json({ success: true }, { status: 200, headers: jsonHeaders });
};
