import { signToken, verifyToken } from '@lasvegasfortransit/platform-core/signing';
import { randomToken } from '@lasvegasfortransit/platform-core/random-token';
import {
  beginDiscordDisconnect,
  discordDisconnectTarget,
} from '@lasvegasfortransit/platform-storage/discord-disconnect';
import { discordSessionHash } from '@lasvegasfortransit/platform-storage/discord-link';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { DiscordAccess } from './discord-access';
import { discordLinkConfigured, type DiscordLinkEnv } from './discord-link';
import { discordRateLimit } from './discord-rate-limit';
import { discordRuntime, type DiscordRuntimeEnv } from './discord-runtime';
import { requestDiscordService } from './discord-service';
import { syncDiscordOperation } from './discord-sync';
import type { DiscordOptions } from './discord-types';

export interface DiscordDisconnectInput {
  personId: string;
  operationId: string;
  environment: 'preview' | 'production';
}
export interface DiscordDisconnectResult {
  kind: 'disconnected' | 'retry' | 'failed';
}

export function parseDiscordDisconnectInput(value: unknown): DiscordDisconnectInput | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.personId !== 'string' ||
    !input.personId ||
    input.personId.length > 200 ||
    typeof input.operationId !== 'string' ||
    !/^[\w:-]{1,120}$/.test(input.operationId) ||
    (input.environment !== 'preview' && input.environment !== 'production')
  )
    return null;
  return {
    personId: input.personId,
    operationId: input.operationId,
    environment: input.environment,
  };
}

export class DiscordDisconnect {
  constructor(
    private readonly env: DiscordLinkEnv,
    private readonly options: { now?: () => number } = {},
  ) {}
  async formToken(sessionToken: string, origin: string): Promise<string | null> {
    return (await this.form(sessionToken, origin))?.token ?? null;
  }
  async form(
    sessionToken: string,
    origin: string,
  ): Promise<{ token: string; disconnecting: boolean } | null> {
    if (!discordLinkConfigured(this.env)) return null;
    const now = this.options.now?.() ?? Date.now();
    const target = await discordDisconnectTarget(this.env, sessionToken, origin, new Date(now));
    return target
      ? {
          token: await signToken(this.env.LVBT_SIGN_IN_SECRET, {
            purpose: 'discord_disconnect',
            subject: await discordSessionHash(this.env, sessionToken),
            expiresAt: now + 900_000,
            data: {
              origin,
              identityRecordId: target.identityRecordId,
              operationId: `discord-disconnect:${randomToken()}`,
            },
          }),
          disconnecting: target.disconnecting,
        }
      : null;
  }
  private async confirmation(
    input: { sessionToken: string; origin: string; csrfToken: string },
    now: number,
  ): Promise<{ identityRecordId: string; operationId: string } | null> {
    const token = await verifyToken(
      this.env.LVBT_SIGN_IN_SECRET,
      input.csrfToken,
      'discord_disconnect',
      now,
    );
    if (
      !token ||
      token.expiresAt <= now ||
      token.subject !== (await discordSessionHash(this.env, input.sessionToken)) ||
      token.data?.origin !== input.origin ||
      typeof token.data.identityRecordId !== 'string' ||
      typeof token.data.operationId !== 'string'
    )
      return null;
    return { identityRecordId: token.data.identityRecordId, operationId: token.data.operationId };
  }
  async disconnect(input: {
    sessionToken: string;
    origin: string;
    csrfToken: string;
  }): Promise<DiscordDisconnectResult> {
    if (!discordLinkConfigured(this.env) || input.csrfToken.length > 1500)
      return { kind: 'failed' };
    const now = this.options.now?.() ?? Date.now();
    const confirmation = await this.confirmation(input, now);
    if (!confirmation) return { kind: 'failed' };
    const pending = await beginDiscordDisconnect(this.env, {
      ...input,
      ...confirmation,
      now: new Date(now),
    });
    const jobs = this.env.LVBT_DISCORD_JOBS;
    const environment = this.env.LVBT_DEPLOYMENT_ENV;
    if (!pending || !jobs || (environment !== 'preview' && environment !== 'production'))
      return { kind: 'failed' };
    const result = await requestDiscordService(jobs, '/discord/disconnect', {
      ...pending,
      environment,
    });
    if (
      typeof result === 'object' &&
      result !== null &&
      'kind' in result &&
      (result.kind === 'disconnected' || result.kind === 'failed')
    )
      return { kind: result.kind };
    return { kind: 'retry' };
  }
}

/** Request-only private operation; the bot token never leaves the jobs Worker. */
export async function disconnectDiscordMember(
  db: Db,
  env: DiscordRuntimeEnv,
  value: unknown,
  options: DiscordOptions = {},
): Promise<DiscordDisconnectResult> {
  const input = parseDiscordDisconnectInput(value);
  if (!input || input.environment !== env.LVBT_DEPLOYMENT_ENV) return { kind: 'failed' };
  const runtime = discordRuntime(env);
  if (!runtime) return { kind: 'retry' };
  const pending = await db
    .prepare(
      `SELECT 1 FROM discord_disconnects d JOIN identities i ON i.id=d.identity_record_id
    WHERE d.operation_id=? AND i.person_id=? AND i.platform='discord'`,
    )
    .bind(input.operationId, input.personId)
    .first();
  if (!pending) return { kind: 'failed' };
  const now = options.now ?? Date.now;
  const rateLimit = discordRateLimit(db, runtime.applicationId, () => new Date(now()));
  if (await rateLimit.current()) return { kind: 'retry' };
  try {
    const result = await syncDiscordOperation(db, input.operationId, {
      client: new DiscordAccess(runtime.configuration, { ...options, rateLimit }),
      memberRoleId: runtime.memberRoleId,
      now: () => new Date(now()),
    });
    return { kind: result.kind === 'confirmed' ? 'disconnected' : 'retry' };
  } catch {
    return { kind: 'retry' };
  }
}
