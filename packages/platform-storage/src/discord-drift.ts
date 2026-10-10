import { isDiscordId } from '@lasvegasfortransit/platform-core/discord-identity';
import type { Db } from './db';
import {
  claimDiscordScan,
  releaseDiscordScan,
  SCAN_CURRENT,
  scanValues,
  type DiscordScanLease,
} from './discord-scan-store';

interface Options {
  guildId: string;
  limit?: number;
  now?: () => Date;
}
export interface DiscordDriftResult {
  kind: 'scanned' | 'idle' | 'busy' | 'stale';
  scanned: number;
  queued: number;
  complete: boolean;
}
const ELIGIBLE = `p.deleted_at IS NULL AND
  (SELECT count(*) FROM identities WHERE person_id=p.id AND platform='discord')=1 AND
  EXISTS(SELECT 1 FROM identities WHERE person_id=p.id AND platform='discord' AND link_method IN ('self_linked','staff_confirmed'))`;
function changes(result: unknown): number {
  if (typeof result !== 'object' || result === null || !('meta' in result)) return 0;
  const meta = result.meta;
  if (typeof meta !== 'object' || meta === null || !('changes' in meta)) return 0;
  return typeof meta.changes === 'number' ? meta.changes : 0;
}
async function advance(
  db: Db,
  scan: DiscordScanLease,
  page: { ids: string[]; more: boolean },
  now: Date,
) {
  const { ids, more } = page;
  const selected = JSON.stringify(ids),
    stamp = now.toISOString(),
    guard = scanValues(scan, now);
  const result = await db.batch([
    db
      .prepare(
        `INSERT INTO reconcile_generations(person_id,target_id,generation)
      SELECT p.id,'person',1 FROM people p JOIN json_each(?) chosen ON chosen.value=p.id
      WHERE ${ELIGIBLE} AND ${SCAN_CURRENT} ON CONFLICT(person_id,target_id) DO NOTHING`,
      )
      .bind(selected, ...guard),
    db
      .prepare(
        `INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at)
      SELECT ? || ':' || p.id || ':' || g.generation,'person_reconcile',p.id,'person',g.generation,?,?,?,?
      FROM people p JOIN json_each(?) chosen ON chosen.value=p.id JOIN reconcile_generations g ON g.person_id=p.id AND g.target_id='person'
      WHERE ${ELIGIBLE} AND ${SCAN_CURRENT}
      AND NOT EXISTS(SELECT 1 FROM integration_outbox o JOIN reconcile_generations current ON current.person_id=o.person_id AND current.target_id=o.target_id AND current.generation=o.generation
        WHERE o.person_id=p.id AND o.kind IN ('person_reconcile','committee_reconcile') AND o.state IN ('queued','running','retry'))
      ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        `discord-drift:${scan.guildId}:${scan.startedAt}`,
        JSON.stringify({ source: 'discord_drift', guildId: scan.guildId }),
        stamp,
        stamp,
        stamp,
        selected,
        ...guard,
      ),
    db
      .prepare(
        `UPDATE provider_scan_checkpoints SET cursor=?,in_progress=?,last_completed_at=CASE WHEN ?=0 THEN ? ELSE last_completed_at END,lease_token=NULL,lease_expires_at=NULL WHERE provider='discord' AND context_id=? AND ${SCAN_CURRENT}`,
      )
      .bind(
        more ? (ids.at(-1) ?? scan.cursor) : null,
        Number(more),
        Number(more),
        stamp,
        scan.guildId,
        ...guard,
      ),
  ]);
  return changes(result[2])
    ? {
        kind: 'scanned' as const,
        scanned: ids.length,
        queued: changes(result[1]),
        complete: !more,
      }
    : { kind: 'stale' as const, scanned: 0, queued: 0, complete: false };
}
/** Revisit every live verified link; membership and assignment revisions remain authoritative. */
export async function queueDiscordDrift(db: Db, options: Options): Promise<DiscordDriftResult> {
  const limit = options.limit ?? 100,
    now = options.now ?? (() => new Date()),
    started = now();
  if (
    !isDiscordId(options.guildId) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isFinite(started.getTime())
  )
    throw new Error('Invalid Discord scan configuration');
  const scan = await claimDiscordScan(db, options.guildId, started);
  if (typeof scan === 'string') return { kind: scan, scanned: 0, queued: 0, complete: false };
  try {
    const { results } = await db
      .prepare(`SELECT p.id FROM people p WHERE ${ELIGIBLE} AND p.id>? ORDER BY p.id LIMIT ?`)
      .bind(scan.cursor ?? '', limit + 1)
      .all<{ id: string }>();
    return await advance(
      db,
      scan,
      { ids: results.slice(0, limit).map((row) => row.id), more: results.length > limit },
      now(),
    );
  } finally {
    await releaseDiscordScan(db, scan);
  }
}
