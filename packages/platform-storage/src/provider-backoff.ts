import type { Db } from './db';
export interface ProviderPause {
  retryAfterMs: number;
  global: boolean;
}
export type BackoffProvider = 'discord' | 'google_workspace';
export interface ProviderBackoffWrite {
  provider: BackoffProvider;
  contextId: string;
  pause: ProviderPause;
  now: Date;
}

export async function providerPause(
  db: Db,
  provider: BackoffProvider,
  contextId: string,
  now: Date,
): Promise<ProviderPause | null> {
  const row = await db
    .prepare(
      'SELECT expires_at,is_global FROM provider_backoffs WHERE provider=? AND context_id=? AND expires_at>?',
    )
    .bind(provider, contextId, now.toISOString())
    .first<{ expires_at: string; is_global: number }>();
  return row
    ? {
        retryAfterMs: new Date(row.expires_at).getTime() - now.getTime(),
        global: Boolean(row.is_global),
      }
    : null;
}
export async function deferProvider(db: Db, input: ProviderBackoffWrite): Promise<void> {
  const { provider, contextId, pause, now } = input;
  if (
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(pause.retryAfterMs) ||
    pause.retryAfterMs <= 0 ||
    pause.retryAfterMs > 86_400_000
  )
    throw new Error('Invalid provider retry deadline');
  await db
    .prepare(
      `INSERT INTO provider_backoffs(provider,context_id,expires_at,is_global,updated_at)
    VALUES (?,?,?,?,?) ON CONFLICT(provider,context_id) DO UPDATE SET
    expires_at=excluded.expires_at,is_global=excluded.is_global,updated_at=excluded.updated_at
    WHERE excluded.expires_at>provider_backoffs.expires_at`,
    )
    .bind(
      provider,
      contextId,
      new Date(now.getTime() + pause.retryAfterMs).toISOString(),
      Number(pause.global),
      now.toISOString(),
    )
    .run();
}

export async function discordPause(
  db: Db,
  applicationId: string,
  now: Date,
): Promise<ProviderPause | null> {
  return await providerPause(db, 'discord', applicationId, now);
}

export async function deferDiscord(
  db: Db,
  applicationId: string,
  pause: ProviderPause,
  now: Date,
): Promise<void> {
  await deferProvider(db, { provider: 'discord', contextId: applicationId, pause, now });
}
