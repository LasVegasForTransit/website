import { hashWithSecret } from '@lasvegasfortransit/platform-core/signing';
import { digestToken, randomToken } from '@lasvegasfortransit/platform-core/random-token';
import {
  isDiscordIdentity,
  type DiscordIdentity,
} from '@lasvegasfortransit/platform-core/discord-identity';
import type { AuthEnv } from './auth';
import { completeDiscordLink } from './discord-link-write';

export interface DiscordLinkClaim {
  stateHash: string;
  claimToken: string;
  personId: string;
  sessionHash: string;
  origin: string;
  callbackUrl: string;
}
interface BrowserInput {
  sessionToken: string;
  origin: string;
  now?: Date;
}
export interface DiscordLinkProfile {
  linked: boolean;
  ambiguous: boolean;
  username: string | null;
}
export function discordLinkOrigin(origin: string): boolean {
  return ['https://lasvegasfortransit.org', 'https://preview.lasvegasfortransit.org'].includes(
    origin,
  );
}
export function discordCallback(origin: string): string {
  return `${origin}/account/discord/callback`;
}
export function discordSessionHash(env: AuthEnv, token: string): Promise<string> {
  return hashWithSecret(env.LVBT_SIGN_IN_SECRET, `session:${token}`);
}
const LIVE_MEMBER = `s.expires_at>? AND p.deleted_at IS NULL AND p.membership_status='member'
 AND (SELECT count(*) FROM identities i WHERE i.person_id=p.id AND i.platform='discord')<=1`;

export class DiscordLinkService {
  constructor(private readonly env: AuthEnv) {}
  async profile(sessionToken: string): Promise<DiscordLinkProfile | null> {
    if (!/^[\w-]{43}$/.test(sessionToken)) return null;
    const row = await this.env.PLATFORM_DB.prepare(
      `SELECT
      (SELECT count(*) FROM identities i WHERE i.person_id=p.id AND i.platform='discord') AS count,
      EXISTS(SELECT 1 FROM identities i WHERE i.person_id=p.id AND i.platform='discord' AND i.link_method IN ('self_linked','staff_confirmed')) AS linked,
      (SELECT profile.username FROM identities i JOIN discord_identity_profiles profile ON profile.identity_record_id=i.id
       WHERE i.person_id=p.id AND i.platform='discord' AND i.link_method IN ('self_linked','staff_confirmed') LIMIT 1) AS username
      FROM sessions s JOIN people p ON p.id=s.person_id WHERE s.id_hash=? AND s.expires_at>? AND p.deleted_at IS NULL AND p.membership_status='member'`,
    )
      .bind(await discordSessionHash(this.env, sessionToken), new Date().toISOString())
      .first<{ count: number; linked: number; username: string | null }>();
    return row
      ? {
          linked: row.count === 1 && Boolean(row.linked),
          ambiguous: row.count > 1,
          username: row.count === 1 ? row.username : null,
        }
      : null;
  }
  async begin(input: BrowserInput): Promise<{ state: string; callbackUrl: string } | null> {
    const now = input.now ?? new Date();
    if (!this.validBrowser(input, now)) return null;
    const sessionHash = await discordSessionHash(this.env, input.sessionToken);
    const state = randomToken(),
      stateHash = await digestToken(state);
    await this.env.PLATFORM_DB.batch([
      this.env.PLATFORM_DB.prepare(
        'DELETE FROM discord_link_states WHERE session_hash=? AND (completed_at IS NULL OR expires_at<=?)',
      ).bind(sessionHash, now.toISOString()),
      this.env.PLATFORM_DB.prepare(
        `INSERT INTO discord_link_states (state_hash,person_id,session_hash,origin_url,expires_at,created_at)
        SELECT ?,p.id,s.id_hash,?,?,? FROM sessions s JOIN people p ON p.id=s.person_id WHERE s.id_hash=? AND ${LIVE_MEMBER}`,
      ).bind(
        stateHash,
        input.origin,
        new Date(now.getTime() + 600_000).toISOString(),
        now.toISOString(),
        sessionHash,
        now.toISOString(),
      ),
    ]);
    const stored = await this.env.PLATFORM_DB.prepare(
      'SELECT 1 FROM discord_link_states WHERE state_hash=?',
    )
      .bind(stateHash)
      .first();
    return stored ? { state, callbackUrl: discordCallback(input.origin) } : null;
  }
  async claim(input: BrowserInput & { state: string }): Promise<DiscordLinkClaim | null> {
    const now = input.now ?? new Date();
    if (!this.validBrowser(input, now) || !/^[\w-]{43}$/.test(input.state)) return null;
    const stateHash = await digestToken(input.state),
      sessionHash = await discordSessionHash(this.env, input.sessionToken);
    const claimToken = randomToken();
    const claimed = await this.env.PLATFORM_DB.prepare(
      `UPDATE discord_link_states SET claim_token=?,claimed_at=?
      WHERE state_hash=? AND session_hash=? AND origin_url=? AND expires_at>? AND claim_token IS NULL AND completed_at IS NULL
      AND EXISTS(SELECT 1 FROM sessions s JOIN people p ON p.id=s.person_id WHERE s.id_hash=discord_link_states.session_hash AND p.id=discord_link_states.person_id AND ${LIVE_MEMBER})
      RETURNING person_id`,
    )
      .bind(
        claimToken,
        now.toISOString(),
        stateHash,
        sessionHash,
        input.origin,
        now.toISOString(),
        now.toISOString(),
      )
      .first<{ person_id: string }>();
    return claimed
      ? {
          stateHash,
          sessionHash,
          claimToken,
          personId: claimed.person_id,
          origin: input.origin,
          callbackUrl: discordCallback(input.origin),
        }
      : null;
  }
  async complete(input: {
    claim: DiscordLinkClaim;
    identity: DiscordIdentity;
    now?: Date;
  }): Promise<boolean> {
    const now = input.now ?? new Date();
    if (
      !Number.isFinite(now.getTime()) ||
      !discordLinkOrigin(input.claim.origin) ||
      input.claim.callbackUrl !== discordCallback(input.claim.origin) ||
      !isDiscordIdentity(input.identity)
    )
      return false;
    return await completeDiscordLink(this.env.PLATFORM_DB, { ...input, now });
  }
  private validBrowser(input: BrowserInput, now: Date): boolean {
    return (
      Boolean(this.env.LVBT_SIGN_IN_SECRET) &&
      Number.isFinite(now.getTime()) &&
      discordLinkOrigin(input.origin) &&
      /^[\w-]{43}$/.test(input.sessionToken)
    );
  }
}
