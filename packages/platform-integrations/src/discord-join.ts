import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  discordJoinIsCurrent,
  queueDiscordJoin,
} from '@lasvegasfortransit/platform-storage/discord-join';
import { DiscordAccess } from './discord-access';
import { DiscordHttp } from './discord-http';
import { discordRateLimit } from './discord-rate-limit';
import { discordRuntime, type DiscordRuntimeEnv } from './discord-runtime';
import {
  discordId,
  DiscordApiFailure,
  parseDiscordUser,
  type DiscordOptions,
} from './discord-types';

export interface DiscordJoinInput {
  personId: string;
  discordId: string;
  accessToken: string;
  operationId: string;
  environment: 'preview' | 'production';
}
export interface DiscordJoinResult {
  kind: 'connected' | 'screening_pending' | 'retry' | 'failed';
}
function parsedResult(value: unknown): DiscordJoinResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { kind: 'retry' };
  const kind = (value as Record<string, unknown>).kind;
  return kind === 'connected' ||
    kind === 'screening_pending' ||
    kind === 'retry' ||
    kind === 'failed'
    ? { kind }
    : { kind: 'retry' };
}

async function readResult(response: Response, signal: AbortSignal): Promise<DiscordJoinResult> {
  if (response.status !== 200) return { kind: 'retry' };
  const reader = response.body?.getReader();
  if (!reader) return { kind: 'retry' };
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  let bytes = 0;
  let text = '';
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      const chunk: unknown = part.value;
      if (!(chunk instanceof Uint8Array)) return { kind: 'retry' };
      bytes += chunk.byteLength;
      if (bytes > 512) return { kind: 'retry' };
      text += decoder.decode(chunk, { stream: true });
    }
    const value: unknown = JSON.parse(text + decoder.decode());
    return signal.aborted ? { kind: 'retry' } : parsedResult(value);
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
  }
}

export async function requestDiscordJoin(
  jobs: Pick<Fetcher, 'fetch'>,
  input: DiscordJoinInput,
): Promise<DiscordJoinResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      jobs
        .fetch(
          new Request('https://jobs.internal/discord/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
            redirect: 'manual',
            signal: controller.signal,
          }),
        )
        .then(async (response) => await readResult(response, controller.signal)),
      new Promise<DiscordJoinResult>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ kind: 'retry' });
        }, 20_000);
      }),
    ]);
  } catch {
    return { kind: 'retry' };
  } finally {
    clearTimeout(timer);
  }
}

export function parseDiscordJoinInput(value: unknown): DiscordJoinInput | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.personId !== 'string' ||
    !input.personId.length ||
    input.personId.length > 200 ||
    !discordId(input.discordId) ||
    typeof input.accessToken !== 'string' ||
    !/^[A-Za-z0-9._~+/-]{1,4096}={0,2}$/.test(input.accessToken) ||
    typeof input.operationId !== 'string' ||
    !/^[\w:-]{1,120}$/.test(input.operationId) ||
    (input.environment !== 'preview' && input.environment !== 'production')
  )
    return null;
  return {
    personId: input.personId,
    discordId: input.discordId,
    accessToken: input.accessToken,
    operationId: input.operationId,
    environment: input.environment,
  };
}

/** Tokens live only for this request; persisted work contains no credential. */
export async function joinDiscordMember(
  db: Db,
  env: DiscordRuntimeEnv,
  input: DiscordJoinInput,
  options: DiscordOptions = {},
): Promise<DiscordJoinResult> {
  if (!parseDiscordJoinInput(input) || env.LVBT_DEPLOYMENT_ENV !== input.environment)
    return { kind: 'failed' };
  const runtime = discordRuntime(env);
  if (!runtime) return { kind: 'retry' };
  const now = options.now ?? Date.now;
  const transport = {
    ...options,
    rateLimit: discordRateLimit(db, runtime.applicationId, () => new Date(now())),
  };
  const isCurrent = async () => await discordJoinIsCurrent(db, input);
  try {
    if (!(await isCurrent())) return { kind: 'failed' };
    const http = new DiscordHttp(transport);
    const identity = parseDiscordUser(
      await http.request('/users/@me', { authorization: `Bearer ${input.accessToken}` }),
    );
    if (identity.id !== input.discordId) return { kind: 'failed' };
    const member = await new DiscordAccess(runtime.configuration, transport).joinMember({
      identityId: input.discordId,
      accessToken: input.accessToken,
      isCurrent,
    });
    const queued = await queueDiscordJoin(db, {
      ...input,
      guildId: runtime.configuration.guildId,
      now: new Date(now()),
    });
    if (!queued) return { kind: 'failed' };
    return { kind: member.pending ? 'screening_pending' : 'connected' };
  } catch (error) {
    return {
      kind:
        error instanceof DiscordApiFailure && error.kind === 'stale_operation' ? 'failed' : 'retry',
    };
  }
}
