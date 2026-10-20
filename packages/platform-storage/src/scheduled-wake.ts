import type { Db } from './db';
import { memberPrivacySchedule, nextMemberPrivacyTime } from './member-privacy-schedule';

export type ScheduledGroup = 'providers' | 'profiles' | 'inactive' | 'records';
export interface ScheduledSignal {
  name: ScheduledGroup;
  revision: number;
  configuration: string;
}
export interface ProviderSchedule {
  guildId: string | null;
  applicationId: string | null;
  commandContext: string | null;
  publicationId: string | null;
}
export function nextScheduledHour(now: Date): string {
  return new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000 + 3_600_000).toISOString();
}
/** The table contains exactly four rows; configuration changes also wake dormant work. */
export async function dueScheduledSignals(db: Db, now: Date, configuration: string) {
  return (
    await db
      .prepare(
        `SELECT name,revision,configuration FROM scheduled_work_signals
        WHERE next_run_at<=? UNION SELECT name,revision,configuration FROM scheduled_work_signals
        WHERE configuration<>?`,
      )
      .bind(now.toISOString(), configuration)
      .all<ScheduledSignal>()
  ).results;
}
/** A writer that commits during a pass must retain its own wake. */
export async function acknowledgeScheduledSignal(
  db: Db,
  signal: ScheduledSignal,
  configuration: string,
  next: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE scheduled_work_signals SET next_run_at=?,configuration=?
      WHERE name=? AND revision=? AND configuration=?`,
    )
    .bind(next, configuration, signal.name, signal.revision, signal.configuration)
    .run();
}

async function futureProviderDeadlines(db: Db, now: Date, input: ProviderSchedule) {
  const stamp = now.toISOString();
  return await db
    .prepare(
      `
    WITH candidates(kind,due) AS (VALUES
      ('discord',(SELECT next_attempt_at FROM integration_outbox WHERE state='queued' AND next_attempt_at>? ORDER BY next_attempt_at LIMIT 1)),
      ('discord',(SELECT next_attempt_at FROM integration_outbox WHERE state='running' AND next_attempt_at>? ORDER BY next_attempt_at LIMIT 1)),
      ('discord',(SELECT next_attempt_at FROM integration_outbox WHERE state='retry' AND next_attempt_at>? ORDER BY next_attempt_at LIMIT 1)),
      ('newsletter',(SELECT max(next_attempt_at,coalesce(lease_expires_at,next_attempt_at)) FROM newsletter_sync_jobs WHERE state='queued' AND max(next_attempt_at,coalesce(lease_expires_at,next_attempt_at))>? ORDER BY max(next_attempt_at,coalesce(lease_expires_at,next_attempt_at)) LIMIT 1)),
      ('newsletter',(SELECT max(next_attempt_at,coalesce(lease_expires_at,next_attempt_at)) FROM newsletter_sync_jobs WHERE state='running' AND max(next_attempt_at,coalesce(lease_expires_at,next_attempt_at))>? ORDER BY max(next_attempt_at,coalesce(lease_expires_at,next_attempt_at)) LIMIT 1)),
      ('newsletter',(SELECT max(next_attempt_at,coalesce(lease_expires_at,next_attempt_at)) FROM newsletter_sync_jobs WHERE state='retry' AND max(next_attempt_at,coalesce(lease_expires_at,next_attempt_at))>? ORDER BY max(next_attempt_at,coalesce(lease_expires_at,next_attempt_at)) LIMIT 1)),
      ('local',(SELECT strftime('%Y-%m-%dT%H:%M:%fZ',occurred_at) FROM newsletter_inbound_events WHERE state='pending' AND julianday(occurred_at)>julianday(?) ORDER BY julianday(occurred_at) LIMIT 1)),
      ('local',(SELECT observed_at FROM newsletter_poll_choices WHERE publication_id=? AND state='pending' AND observed_at>? ORDER BY observed_at LIMIT 1)),
      ('discord',(SELECT expires_at FROM provider_account_leases WHERE expires_at>? ORDER BY expires_at LIMIT 1)),
      ('newsletter',(SELECT expires_at FROM newsletter_account_leases WHERE expires_at>? ORDER BY expires_at LIMIT 1)),
      ('local',(SELECT expires_at FROM provider_operation_receipts WHERE expires_at>? ORDER BY expires_at LIMIT 1)),
      ('local',(SELECT strftime('%Y-%m-%dT%H:%M:%fZ',observed_at,'+1 hour') FROM provider_operation_receipts WHERE provider='discord' AND observed_at>? ORDER BY observed_at LIMIT 1))
    ) SELECT kind,due FROM candidates`,
    )
    .bind(
      stamp,
      stamp,
      stamp,
      stamp,
      stamp,
      stamp,
      stamp,
      input.publicationId,
      stamp,
      stamp,
      stamp,
      stamp,
      new Date(now.getTime() - 3_600_000).toISOString(),
    )
    .all<{ kind: string; due: string | null }>();
}
async function providerCheckpointDeadlines(db: Db, now: Date, input: ProviderSchedule) {
  const stamp = now.toISOString();
  return await db
    .prepare(
      `
    SELECT 'discord' AS kind,max(CASE WHEN in_progress=1 THEN ? ELSE next_scan_at END,coalesce(lease_expires_at,?)) AS due
      FROM provider_scan_checkpoints WHERE provider='discord' AND context_id IN (?,?)
    UNION ALL SELECT 'discord',max(next_scan_at,coalesce(lease_expires_at,?)) FROM provider_scan_checkpoints
      WHERE provider='discord' AND context_id=? AND last_completed_at IS NULL
    UNION ALL SELECT 'newsletter',max(CASE WHEN in_progress=1 THEN ? ELSE next_scan_at END,next_attempt_at,coalesce(lease_expires_at,?))
      FROM beehiiv_poll_checkpoints WHERE publication_id=?
    UNION ALL SELECT 'discord_pause',expires_at FROM provider_backoffs WHERE provider='discord' AND context_id IN (?,?) AND expires_at>?
    UNION ALL SELECT 'newsletter_pause',until_at FROM newsletter_provider_backoffs WHERE publication_id=? AND until_at>?`,
    )
    .bind(
      stamp,
      stamp,
      input.guildId,
      input.guildId ? `guild-roster:${input.guildId}` : null,
      stamp,
      input.commandContext,
      stamp,
      stamp,
      input.publicationId,
      input.applicationId,
      input.guildId,
      stamp,
      input.publicationId,
      stamp,
    )
    .all<{ kind: string; due: string | null }>();
}

/** Query future work only after an admitted pass, never on a quiet minute. */
export async function nextProviderWork(
  db: Db,
  now: Date,
  input: ProviderSchedule,
  more: boolean,
): Promise<string> {
  const stamp = now.toISOString();
  const tomorrow = new Date(now.getTime() + 86_400_000).toISOString();
  const candidates = [new Date(now.getTime() + 15 * 60_000).toISOString()];
  if (more) candidates.push(new Date(now.getTime() + 60_000).toISOString());
  // Each queue branch seeks into a due-time index and returns at most one row.
  // Past, non-actionable outbox entries sleep until an input changes or the
  // reconciliation deadline arrives instead of forcing an endless empty drain.
  const future = await futureProviderDeadlines(db, now, input);
  const checkpoints = await providerCheckpointDeadlines(db, now, input);
  const pauses = new Map<string, string>();
  for (const row of checkpoints.results.filter((row) => row.kind.endsWith('_pause'))) {
    if (row.due && row.due > (pauses.get(row.kind) ?? stamp)) pauses.set(row.kind, row.due);
  }
  for (const row of [...future.results, ...checkpoints.results]) {
    if (!row.due || row.kind.endsWith('_pause')) continue;
    const due = [row.due, pauses.get(`${row.kind}_pause`) ?? stamp].sort().at(-1);
    if (due) candidates.push(due > stamp ? due : new Date(now.getTime() + 60_000).toISOString());
  }
  // Null fallback makes the bound explicit even when a provider is disabled.
  return candidates.reduce((a, b) => (a < b ? a : b), tomorrow);
}

export async function nextProfileWork(db: Db, now: Date): Promise<string> {
  const row = await db
    .prepare(
      `SELECT
    (SELECT 1 FROM people p WHERE p.deleted_at IS NOT NULL AND p.erased_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM merges m WHERE m.merged_person_id=p.id AND m.unmerged_at IS NULL
        AND m.erased_at IS NULL AND m.merged_at=p.deleted_at) ORDER BY p.deleted_at,p.id LIMIT 1) AS pending,
    (SELECT p.deleted_at FROM people p WHERE p.deleted_at IS NOT NULL AND p.erased_at IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM merges m WHERE m.merged_person_id=p.id AND m.unmerged_at IS NULL AND m.erased_at IS NULL)
      ORDER BY p.deleted_at,p.id LIMIT 1) AS purge`,
    )
    .first<{ pending: number | null; purge: string | null }>();
  const next = row?.pending
    ? now.getTime() + 60_000
    : row?.purge
      ? Math.max(now.getTime() + 60_000, Date.parse(row.purge) + 30 * 86_400_000 + 1)
      : now.getTime() + 86_400_000;
  return new Date(next).toISOString();
}
export async function nextInactiveWork(db: Db, now: Date): Promise<string> {
  const schedule = memberPrivacySchedule(now);
  if (schedule) {
    const complete = await db
      .prepare('SELECT 1 FROM member_privacy_runs WHERE local_day=? AND completed_at IS NOT NULL')
      .bind(schedule.day)
      .first();
    if (!complete) return new Date(now.getTime() + 60_000).toISOString();
  }
  return nextMemberPrivacyTime(now).toISOString();
}
export async function nextRecordWork(db: Db, now: Date): Promise<string> {
  const yearsBefore = (years: number) => {
    const date = new Date(now);
    date.setUTCFullYear(date.getUTCFullYear() - years);
    return date.toISOString();
  };
  const row = await db
    .prepare(
      `SELECT 1 WHERE (
    EXISTS(SELECT 1 FROM person_views WHERE occurred_at<?
    ) OR EXISTS(SELECT 1 FROM staff_audits WHERE occurred_at<?
    ) OR EXISTS(SELECT 1 FROM welcome_claims WHERE expires_at<=?
    ) OR EXISTS(SELECT 1 FROM google_group_inventory WHERE observed_at<?
    ) OR EXISTS(SELECT 1 FROM google_group_check_failures WHERE started_at<?
    ) OR EXISTS(SELECT 1 FROM roster_import_records WHERE person_id IS NULL AND evidence IS NOT NULL AND recorded_at<?
  ))`,
    )
    .bind(
      yearsBefore(1),
      yearsBefore(3),
      now.toISOString(),
      new Date(now.getTime() - 86_400_000).toISOString(),
      new Date(now.getTime() - 86_400_000).toISOString(),
      new Date(now.getTime() - 30 * 86_400_000).toISOString(),
    )
    .first();
  return row ? new Date(now.getTime() + 60_000).toISOString() : nextScheduledHour(now);
}

/** Inspect checkpoint keys before invoking a provider that has no due scan. */
export async function readyProviderScans(db: Db, now: Date, input: ProviderSchedule) {
  const stamp = now.toISOString();
  const row = await db
    .prepare(
      `SELECT
    NOT EXISTS(SELECT 1 FROM provider_scan_checkpoints WHERE provider='discord' AND context_id=?
      AND (last_completed_at IS NOT NULL OR next_scan_at>? OR lease_expires_at>?)) AS command,
    (NOT EXISTS(SELECT 1 FROM provider_scan_checkpoints WHERE provider='discord' AND context_id=?
      AND (lease_expires_at>? OR (in_progress=0 AND next_scan_at>?)))
    OR NOT EXISTS(SELECT 1 FROM provider_scan_checkpoints WHERE provider='discord' AND context_id=?
      AND (lease_expires_at>? OR (in_progress=0 AND next_scan_at>?)))) AS discord,
    NOT EXISTS(SELECT 1 FROM beehiiv_poll_checkpoints WHERE publication_id=?
      AND (lease_expires_at>? OR next_attempt_at>? OR (in_progress=0 AND next_scan_at>?))) AS newsletter,
    (EXISTS(SELECT 1 FROM newsletter_inbound_events WHERE state='pending' AND julianday(occurred_at) IS NULL)
      OR EXISTS(SELECT 1 FROM newsletter_inbound_events WHERE state='pending' AND julianday(occurred_at)<=julianday(?))) AS incoming,
    EXISTS(SELECT 1 FROM provider_backoffs WHERE provider='discord' AND context_id=? AND expires_at>?) AS discordPaused,
    EXISTS(SELECT 1 FROM newsletter_provider_backoffs WHERE publication_id=? AND until_at>?) AS newsletterPaused
  `,
    )
    .bind(
      input.commandContext,
      stamp,
      stamp,
      input.guildId,
      stamp,
      stamp,
      input.guildId ? `guild-roster:${input.guildId}` : null,
      stamp,
      stamp,
      input.publicationId,
      stamp,
      stamp,
      stamp,
      stamp,
      input.applicationId,
      stamp,
      input.publicationId,
      stamp,
    )
    .first<{
      command: number;
      discord: number;
      newsletter: number;
      incoming: number;
      discordPaused: number;
      newsletterPaused: number;
    }>();
  if (!row) throw new Error('Scheduled readiness unavailable');
  return {
    ...row,
    command: row.discordPaused ? 0 : row.command,
    discord: row.discordPaused ? 0 : row.discord,
    newsletter: row.newsletterPaused ? 0 : row.newsletter,
  };
}
/** Input processing can create outgoing work, so read queues after scans and choices. */
export async function readyProviderQueues(db: Db, now: Date, input: ProviderSchedule) {
  const stamp = now.toISOString();
  const row = await db
    .prepare(
      `SELECT
    EXISTS(SELECT 1 FROM integration_outbox WHERE kind IN ('person_reconcile','committee_reconcile') AND state IN ('queued','running','retry') AND next_attempt_at<=?) AS outbox,
    EXISTS(SELECT 1 FROM newsletter_sync_jobs WHERE state IN ('queued','running','retry') AND max(next_attempt_at,coalesce(lease_expires_at,next_attempt_at))<=?) AS newsletter,
    EXISTS(SELECT 1 FROM newsletter_poll_choices WHERE publication_id=? AND state IN ('pending','needs_review') AND observed_at<=?) AS choices,
    EXISTS(SELECT 1 FROM provider_backoffs WHERE provider='discord' AND context_id=? AND expires_at>?) AS discordPaused,
    EXISTS(SELECT 1 FROM newsletter_provider_backoffs WHERE publication_id=? AND until_at>?) AS newsletterPaused
  `,
    )
    .bind(
      stamp,
      stamp,
      input.publicationId,
      stamp,
      input.applicationId,
      stamp,
      input.publicationId,
      stamp,
    )
    .first<{
      outbox: number;
      newsletter: number;
      choices: number;
      discordPaused: number;
      newsletterPaused: number;
    }>();
  if (!row) throw new Error('Scheduled queue readiness unavailable');
  return row;
}

export { outboxSelectionHasMore } from './outbox-selection';
