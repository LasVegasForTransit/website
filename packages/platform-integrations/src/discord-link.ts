import { signToken, verifyToken } from '@lasvegasfortransit/platform-core/signing';
import { isDiscordId } from '@lasvegasfortransit/platform-core/discord-identity';
import { readSession, type AuthEnv } from '@lasvegasfortransit/platform-storage/auth';
import {
  DiscordLinkService,
  discordLinkOrigin,
  discordSessionHash,
} from '@lasvegasfortransit/platform-storage/discord-link';
import { DiscordHttp } from './discord-http';
import { object, parseDiscordUser, DiscordApiFailure, type DiscordOptions } from './discord-types';
export interface DiscordLinkEnv extends AuthEnv {
  LVBT_DISCORD_APPLICATION_ID?: string | undefined;
  LVBT_DISCORD_CLIENT_SECRET?: string | undefined;
}
export function discordLinkConfigured(env: Partial<DiscordLinkEnv>): boolean {
  return (
    isDiscordId(env.LVBT_DISCORD_APPLICATION_ID) &&
    typeof env.LVBT_DISCORD_CLIENT_SECRET === 'string' &&
    /^[\x21-\x7e]{1,2048}$/.test(env.LVBT_DISCORD_CLIENT_SECRET)
  );
}
interface StartInput {
  sessionToken: string;
  origin: string;
  csrfToken: string;
}
function bearerToken(value: unknown): string {
  const token = object(value);
  if (
    token.token_type !== 'Bearer' ||
    typeof token.scope !== 'string' ||
    !token.scope.split(/\s+/).includes('identify') ||
    typeof token.expires_in !== 'number' ||
    !Number.isFinite(token.expires_in) ||
    token.expires_in <= 0 ||
    typeof token.access_token !== 'string' ||
    !/^[A-Za-z0-9._~+/-]{1,4096}={0,2}$/.test(token.access_token)
  )
    throw new DiscordApiFailure('invalid_response');
  return token.access_token;
}
export class DiscordLink {
  private readonly env: DiscordLinkEnv;
  private readonly service: DiscordLinkService;
  private readonly http: DiscordHttp;
  private readonly now: () => number;
  constructor(env: DiscordLinkEnv, options: DiscordOptions = {}) {
    this.env = Object.freeze({ ...env });
    this.service = new DiscordLinkService(this.env);
    this.http = new DiscordHttp(options);
    this.now = options.now ?? Date.now;
  }
  async formToken(sessionToken: string, origin: string): Promise<string | null> {
    if (
      !discordLinkConfigured(this.env) ||
      !discordLinkOrigin(origin) ||
      !/^[\w-]{43}$/.test(sessionToken)
    )
      return null;
    const session = await readSession(this.env, sessionToken);
    if (session?.person.membershipStatus !== 'member') return null;
    return await signToken(this.env.LVBT_SIGN_IN_SECRET, {
      purpose: 'discord_link_start',
      subject: await discordSessionHash(this.env, sessionToken),
      expiresAt: this.now() + 900_000,
      data: { origin },
    });
  }
  async start(input: StartInput): Promise<{ url: string; state: string } | null> {
    if (
      !discordLinkConfigured(this.env) ||
      !discordLinkOrigin(input.origin) ||
      input.csrfToken.length > 1500
    )
      return null;
    const token = await verifyToken(
      this.env.LVBT_SIGN_IN_SECRET,
      input.csrfToken,
      'discord_link_start',
      this.now(),
    );
    if (
      !token ||
      token.expiresAt <= this.now() ||
      token.subject !== (await discordSessionHash(this.env, input.sessionToken)) ||
      token.data?.origin !== input.origin
    )
      return null;
    const started = await this.service.begin({
      sessionToken: input.sessionToken,
      origin: input.origin,
      now: new Date(this.now()),
    });
    if (!started) return null;
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({
      client_id: this.env.LVBT_DISCORD_APPLICATION_ID ?? '',
      response_type: 'code',
      scope: 'identify',
      prompt: 'consent',
      state: started.state,
      redirect_uri: started.callbackUrl,
    }).toString();
    return { url: url.href, state: started.state };
  }
  async callback(input: {
    sessionToken: string;
    origin: string;
    state: string;
    code: string;
  }): Promise<boolean> {
    if (!discordLinkConfigured(this.env) || !input.code || input.code.length > 2048) return false;
    const claim = await this.service.claim({ ...input, now: new Date(this.now()) });
    if (!claim) return false;
    const token = bearerToken(
      await this.http.request('/oauth2/token', {
        method: 'POST',
        authorization: `Basic ${btoa(`${this.env.LVBT_DISCORD_APPLICATION_ID}:${this.env.LVBT_DISCORD_CLIENT_SECRET}`)}`,
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: input.code,
          redirect_uri: claim.callbackUrl,
        }),
      }),
    );
    const identity = parseDiscordUser(
      await this.http.request('/users/@me', { authorization: `Bearer ${token}` }),
    );
    return await this.service.complete({ claim, identity, now: new Date(this.now()) });
  }
}
