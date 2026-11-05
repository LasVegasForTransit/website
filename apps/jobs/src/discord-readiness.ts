import { readDiscordInput, discordResponse } from './discord-request';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { DiscordAccess } from '@lasvegasfortransit/platform-integrations/discord-access';
import { discordRateLimit } from '@lasvegasfortransit/platform-integrations/discord-rate-limit';
import {
  discordRuntime,
  type DiscordRuntimeEnv,
} from '@lasvegasfortransit/platform-integrations/discord-runtime';

const CURRENT = `p.id=? AND p.deleted_at IS NULL
 AND EXISTS(SELECT 1 FROM workspace_enrollments e WHERE e.person_id=p.id AND e.state='active')
 AND i.person_id=p.id AND i.platform='discord' AND i.link_method IN ('self_linked','staff_confirmed')
 AND (SELECT count(*) FROM identities WHERE person_id=p.id AND platform='discord')=1
 AND NOT EXISTS(SELECT 1 FROM discord_disconnects d WHERE d.identity_record_id=i.id)`;

/** Private readback only; the browser cannot submit a guild, identity or observed state. */
export async function handleDiscordReadinessRequest(
  request: Request,
  env: DiscordRuntimeEnv & { PLATFORM_DB: Db },
  options: ConstructorParameters<typeof DiscordAccess>[1] = {},
): Promise<Response> {
  if (request.method !== 'POST' || request.url !== 'https://jobs.internal/discord/readiness')
    return discordResponse('failed', 404);
  if (request.headers.get('Content-Type') !== 'application/json')
    return discordResponse('failed', 400);
  const body = await readDiscordInput(request);
  const input = parseInput(body, env.LVBT_DEPLOYMENT_ENV);
  if (!input) return discordResponse('failed', 400);
  const runtime = discordRuntime(env);
  if (!runtime) return discordResponse('retry', 503);
  const db = env.PLATFORM_DB;
  const target = await db
    .prepare(
      `SELECT i.id,i.external_id FROM people p JOIN identities i ON i.person_id=p.id WHERE ${CURRENT}`,
    )
    .bind(input.personId)
    .first<{ id: string; external_id: string }>();
  if (!target) return discordResponse('failed', 409);
  const now = options.now ?? Date.now;
  // Read-start ordering prevents a slow old observation replacing a newer one.
  const started = new Date(now());
  try {
    const member = await new DiscordAccess(runtime.configuration, {
      ...options,
      rateLimit: discordRateLimit(db, runtime.applicationId, () => new Date(now())),
    }).readMember(target.external_id);
    const written = await writeObservation(db, {
      personId: input.personId,
      target,
      guildId: runtime.configuration.guildId,
      member,
      started,
    });
    return discordResponse(written.meta.changes > 0 ? 'observed' : 'failed', 200);
  } catch {
    return discordResponse('retry', 503);
  }
}

async function writeObservation(
  db: Db,
  {
    personId,
    target,
    guildId,
    member,
    started,
  }: {
    personId: string;
    target: { id: string; external_id: string };
    guildId: string;
    member: Awaited<ReturnType<DiscordAccess['readMember']>>;
    started: Date;
  },
) {
  return await db
    .prepare(
      `INSERT INTO discord_profiles(identity_record_id,guild_id,username,display_name,avatar,nickname,in_guild,pending,observed_at,expires_at)
      SELECT i.id,?,?,?,?,?,?,?,?,? FROM people p JOIN identities i ON i.person_id=p.id
      WHERE ${CURRENT} AND i.id=? AND i.external_id=?
      ON CONFLICT(identity_record_id,guild_id) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,
      avatar=excluded.avatar,nickname=excluded.nickname,in_guild=excluded.in_guild,pending=excluded.pending,
      observed_at=excluded.observed_at,expires_at=excluded.expires_at WHERE excluded.observed_at>=discord_profiles.observed_at`,
    )
    .bind(
      guildId,
      member?.user.username ?? null,
      member?.user.displayName ?? null,
      member?.user.avatar ?? null,
      member?.nickname ?? null,
      Number(Boolean(member)),
      Number(member?.pending ?? false),
      started.toISOString(),
      new Date(started.getTime() + 300_000).toISOString(),
      personId,
      target.id,
      target.external_id,
    )
    .run();
}

function parseInput(body: unknown, environment: string | undefined): { personId: string } | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  return typeof input.personId === 'string' &&
    input.personId.length > 0 &&
    input.personId.length <= 200 &&
    (input.environment === 'preview' || input.environment === 'production') &&
    input.environment === environment
    ? { personId: input.personId }
    : null;
}
