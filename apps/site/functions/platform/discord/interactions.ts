/// <reference types="@cloudflare/workers-types" />

import { isDiscordId } from '@lasvegasfortransit/platform-core/discord-identity';
import { discordLinkOrigin } from '@lasvegasfortransit/platform-storage/discord-link';
import type { SignInPagesEnv } from '../../sign-in/_shared';

const MAX_INTERACTION_BYTES = 16 * 1024;

interface DiscordInteractionEnv extends SignInPagesEnv {
  LVBT_DISCORD_PUBLIC_KEY?: string;
  LVBT_DISCORD_GUILD_ID?: string;
}

interface DiscordInteraction {
  type?: unknown;
  application_id?: unknown;
  guild_id?: unknown;
  data?: { name?: unknown };
  member?: { user?: { id?: unknown } };
  user?: { id?: unknown };
}

function bytesFromHex(value: string, length: number): Uint8Array | null {
  if (value.length !== length * 2 || !/^[0-9a-f]+$/i.test(value)) return null;
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function readBody(request: Request): Promise<string | null> {
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_INTERACTION_BYTES) return null;
  const stream = request.body as ReadableStream<Uint8Array> | null;
  if (!stream) return '';
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = stream.getReader();
  } catch {
    return '';
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    let next = await reader.read();
    while (!next.done) {
      length += next.value.byteLength;
      if (length > MAX_INTERACTION_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
      next = await reader.read();
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function signatureIsValid(
  body: string,
  signature: string,
  timestamp: string,
  publicKey: string,
): Promise<boolean> {
  const keyBytes = bytesFromHex(publicKey, 32);
  const signatureBytes = bytesFromHex(signature, 64);
  if (!keyBytes || !signatureBytes || !/^\d{1,20}$/.test(timestamp)) return false;
  try {
    const key = await crypto.subtle.importKey('raw', arrayBuffer(keyBytes), 'Ed25519', false, [
      'verify',
    ]);
    return await crypto.subtle.verify(
      'Ed25519',
      key,
      arrayBuffer(signatureBytes),
      arrayBuffer(new TextEncoder().encode(timestamp + body)),
    );
  } catch {
    return false;
  }
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function linkReply(request: Request, linked: boolean): Response {
  const origin = new URL(request.url).origin;
  if (!discordLinkOrigin(origin)) return new Response(null, { status: 503 });
  const link = linked
    ? {
        label: 'Open your LVBT account',
        url: `${origin}/account/`,
      }
    : {
        label: 'Connect on lasvegasfortransit.org',
        url: `${origin}/account/discord/`,
      };
  return jsonResponse({
    type: 4,
    data: {
      content: linked
        ? 'Your Discord is already connected to your LVBT account.'
        : "Connect your Discord to your LVBT account and you'll get the LVBT Member role, plus your committee roles if you volunteer. It takes a minute on the website.",
      flags: 64,
      components: [
        {
          type: 1,
          components: [{ type: 2, style: 5, ...link }],
        },
      ],
      allowed_mentions: { parse: [] },
    },
  });
}

function parseInteraction(body: string): DiscordInteraction | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function linkInteraction(
  request: Request,
  env: DiscordInteractionEnv,
  interaction: DiscordInteraction,
): Promise<Response> {
  if (!env.LVBT_DISCORD_APPLICATION_ID || !env.LVBT_DISCORD_GUILD_ID || !env.PLATFORM_DB)
    return new Response(null, { status: 503 });
  if (
    interaction.application_id !== env.LVBT_DISCORD_APPLICATION_ID ||
    interaction.guild_id !== env.LVBT_DISCORD_GUILD_ID
  )
    return new Response(null, { status: 403 });
  const discordId = interaction.member?.user?.id ?? interaction.user?.id;
  if (!isDiscordId(discordId)) return new Response(null, { status: 400 });
  if (!discordLinkOrigin(new URL(request.url).origin)) return new Response(null, { status: 503 });
  try {
    const linked = await env.PLATFORM_DB.prepare(
      "SELECT 1 FROM identities WHERE platform='discord' AND external_id=? AND link_method IN ('self_linked','staff_confirmed') LIMIT 1",
    )
      .bind(discordId)
      .first();
    return linkReply(request, Boolean(linked));
  } catch {
    return new Response(null, { status: 503 });
  }
}

export const onRequestPost: PagesFunction<DiscordInteractionEnv> = async ({ request, env }) => {
  const signature = request.headers.get('X-Signature-Ed25519');
  const timestamp = request.headers.get('X-Signature-Timestamp');
  if (!signature || !timestamp) return new Response(null, { status: 401 });
  if (!env.LVBT_DISCORD_PUBLIC_KEY) return new Response(null, { status: 503 });
  const body = await readBody(request);
  if (body === null) return new Response(null, { status: 413 });
  if (!(await signatureIsValid(body, signature, timestamp, env.LVBT_DISCORD_PUBLIC_KEY)))
    return new Response(null, { status: 401 });
  const interaction = parseInteraction(body);
  if (!interaction) return new Response(null, { status: 400 });
  if (interaction.type === 1) return jsonResponse({ type: 1 });
  if (interaction.type !== 2 || interaction.data?.name !== 'link')
    return new Response(null, { status: 404 });
  return linkInteraction(request, env, interaction);
};
