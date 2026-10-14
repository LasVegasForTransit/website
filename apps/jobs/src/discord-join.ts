import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  joinDiscordMember,
  parseDiscordJoinInput,
} from '@lasvegasfortransit/platform-integrations/discord-join';
import type { DiscordRuntimeEnv } from '@lasvegasfortransit/platform-integrations/discord-runtime';

async function readInput(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const state = { timedOut: false };
  const timer = setTimeout(() => {
    state.timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, 1000);
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let bytes = 0;
  let body = '';
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      const chunk: unknown = part.value;
      if (!(chunk instanceof Uint8Array)) return null;
      bytes += chunk.byteLength;
      if (bytes > 8192) return null;
      body += decoder.decode(chunk, { stream: true });
    }
    return state.timedOut ? null : (JSON.parse(body + decoder.decode()) as unknown);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
}

function response(kind: string, status: number): Response {
  return Response.json({ kind }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function handleDiscordJoinRequest(
  request: Request,
  env: DiscordRuntimeEnv & { PLATFORM_DB: Db },
  options: Parameters<typeof joinDiscordMember>[3] = {},
): Promise<Response> {
  if (request.method !== 'POST' || request.url !== 'https://jobs.internal/discord/join')
    return response('failed', 404);
  if (request.headers.get('Content-Type') !== 'application/json') return response('failed', 400);
  const input = parseDiscordJoinInput(await readInput(request));
  if (!input) return response('failed', 400);
  const result = await joinDiscordMember(env.PLATFORM_DB, env, input, options);
  return response(result.kind, 200);
}
