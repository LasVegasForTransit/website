import { parseEventsFromIcs, type ParsedEventEntry } from './events-parse';
import { stableEventId } from './event-stable-id';

export const FEED_CACHE_TTL_SECONDS = 300;
const FEED_FETCH_TIMEOUT_MS = 5000;
const PARSED_CACHE_SUFFIX = '#parsed-v1';

export interface EventCache {
  match(request: Request): Promise<Response | null | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface LiveEventEntry extends ParsedEventEntry {
  stableId: string;
}

export type LiveEventsResult =
  | { ok: true; entries: LiveEventEntry[]; fromFallback: boolean }
  | { ok: false; reason: 'unavailable' };

export type EventResolution =
  | { kind: 'found'; entry: LiveEventEntry }
  | { kind: 'redirect'; toSlug: string }
  | { kind: 'removed' }
  | { kind: 'not_found' };

interface SlugRow {
  slug: string;
  stable_id: string;
  uid: string;
  is_current: number;
}

interface SnapshotRow {
  ics_sha256: string;
  ics_etag: string | null;
  parsed_json: string;
}

interface SerializedSchemaMetadata extends Record<string, unknown> {
  previousStartDate?: string | undefined;
  doorTime?: string | undefined;
  offer?: (Record<string, unknown> & { validFrom?: string | undefined }) | undefined;
}

interface SerializedEventData extends Record<string, unknown> {
  date: string;
  endDate?: string | undefined;
  schema?: SerializedSchemaMetadata | undefined;
}

interface SerializedLiveEventEntry {
  slug: string;
  digestInput: string;
  stableId: string;
  data: SerializedEventData;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function withStableIds(entries: ParsedEventEntry[]): Promise<LiveEventEntry[]> {
  return Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      stableId: await stableEventId(entry.data.calendarOccurrenceId),
    })),
  );
}

/**
 * Serialize parsed event entries to JSON with ISO dates for zero-parse edge
 * caching and D1 snapshot fallback.
 */
export function serializeLiveEvents(entries: readonly LiveEventEntry[]): string {
  return JSON.stringify(entries);
}

/**
 * Rehydrate serialized live event JSON back into `LiveEventEntry[]` with `Date`
 * objects intact so renderers never touch `ical.js` on warm requests.
 */
export function deserializeLiveEvents(rawJson: string): LiveEventEntry[] {
  const raw = JSON.parse(rawJson) as SerializedLiveEventEntry[];
  return raw.map((entry) => {
    const rawSchema = entry.data.schema;
    const schema = rawSchema
      ? {
          ...(rawSchema as Record<string, unknown>),
          ...(rawSchema.previousStartDate
            ? { previousStartDate: new Date(rawSchema.previousStartDate) }
            : {}),
          ...(rawSchema.doorTime ? { doorTime: new Date(rawSchema.doorTime) } : {}),
          ...(rawSchema.offer
            ? {
                offer: {
                  ...rawSchema.offer,
                  ...(rawSchema.offer.validFrom
                    ? { validFrom: new Date(rawSchema.offer.validFrom) }
                    : {}),
                },
              }
            : {}),
        }
      : undefined;

    return {
      slug: entry.slug,
      digestInput: entry.digestInput,
      stableId: entry.stableId,
      data: {
        ...(entry.data as unknown as LiveEventEntry['data']),
        date: new Date(entry.data.date),
        ...(entry.data.endDate ? { endDate: new Date(entry.data.endDate) } : {}),
        ...(schema ? { schema: schema as LiveEventEntry['data']['schema'] } : {}),
      },
    };
  });
}

async function writeParsedCache(
  cache: EventCache | undefined,
  cacheKey: Request,
  parsedJson: string,
): Promise<void> {
  if (!cache) return;
  await cache.put(
    cacheKey,
    new Response(parsedJson, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${FEED_CACHE_TTL_SECONDS}`,
      },
    }),
  );
}

/**
 * Synchronize active `event_slugs` rows (`is_current = 1`) with the live feed
 * so scans stay bounded to upcoming/current events while historical rows keep
 * 301 and 410 lookups working.
 */
export async function syncEventSlugs(
  db: D1Database | undefined,
  entries: readonly LiveEventEntry[],
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  if (!db) return;
  const existing = await db
    .prepare('SELECT slug, stable_id, uid, is_current FROM event_slugs WHERE is_current = 1')
    .all<SlugRow>();
  const bySlug = new Map(existing.results.map((row) => [row.slug, row]));
  const currentByStableId = new Map(existing.results.map((row) => [row.stable_id, row.slug]));

  const statements: D1PreparedStatement[] = [];
  for (const entry of entries) {
    const previousCurrent = currentByStableId.get(entry.stableId);
    if (previousCurrent && previousCurrent !== entry.slug) {
      statements.push(
        db
          .prepare('UPDATE event_slugs SET is_current = 0 WHERE stable_id = ? AND slug != ?')
          .bind(entry.stableId, entry.slug),
      );
    }

    const row = bySlug.get(entry.slug);
    if (row?.stable_id !== entry.stableId) {
      statements.push(
        db
          .prepare(
            `INSERT INTO event_slugs (slug, stable_id, uid, is_current, first_seen_at, last_seen_at)
             VALUES (?, ?, ?, 1, ?, ?)
             ON CONFLICT(slug) DO UPDATE SET
               stable_id = excluded.stable_id,
               uid = excluded.uid,
               is_current = 1,
               last_seen_at = excluded.last_seen_at`,
          )
          .bind(entry.slug, entry.stableId, entry.data.calendarUid, nowIso, nowIso),
      );
    }
  }

  for (let i = 0; i < statements.length; i += 80) {
    await db.batch(statements.slice(i, i + 80));
  }
}

async function readCachedEvents(
  cache: EventCache | undefined,
  cacheKey: Request,
): Promise<LiveEventEntry[] | null> {
  if (!cache) return null;
  const cached = await cache.match(cacheKey);
  if (!cached?.ok) return null;
  try {
    return deserializeLiveEvents(await cached.text());
  } catch {
    // Fall through to live fetch if cached JSON was corrupted.
    return null;
  }
}

async function readSnapshot(db: D1Database | undefined): Promise<SnapshotRow | null> {
  if (!db) return null;
  try {
    return await db
      .prepare('SELECT ics_sha256, ics_etag, parsed_json FROM event_feed_snapshots WHERE id = 1')
      .first<SnapshotRow>();
  } catch (error) {
    console.error(`events: D1 snapshot read failed: ${String(error)}`);
    return null;
  }
}

async function persistSnapshot(
  db: D1Database | undefined,
  fields: {
    icsSha256: string;
    icsEtag: string | null;
    parsedJson: string;
    icsText: string;
    nowIso: string;
    entries: readonly LiveEventEntry[];
  },
): Promise<void> {
  if (!db) return;
  try {
    await db
      .prepare(
        `INSERT INTO event_feed_snapshots (id, ics_sha256, ics_etag, parsed_json, ics_text, fetched_at)
         VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           ics_sha256 = excluded.ics_sha256,
           ics_etag = excluded.ics_etag,
           parsed_json = excluded.parsed_json,
           ics_text = excluded.ics_text,
           fetched_at = excluded.fetched_at`,
      )
      .bind(fields.icsSha256, fields.icsEtag, fields.parsedJson, fields.icsText, fields.nowIso)
      .run();

    await syncEventSlugs(db, fields.entries, fields.nowIso);
  } catch (error) {
    // Keep serving the live calendar feed if D1 is unmigrated locally or temporarily unavailable.
    console.error(`events: D1 snapshot sync failed: ${String(error)}`);
  }
}

function snapshotFallback(snapshot: SnapshotRow | null): LiveEventsResult {
  if (!snapshot?.parsed_json) return { ok: false, reason: 'unavailable' };
  try {
    return {
      ok: true,
      entries: deserializeLiveEvents(snapshot.parsed_json),
      fromFallback: true,
    };
  } catch (error) {
    console.error(`events: snapshot parse failed: ${String(error)}`);
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * Load events for on-request rendering: 5-minute edge cache storing parsed JSON
 * entries, conditional ETag/SHA-256 short-circuiting against D1 so unchanged
 * refreshes skip `ical.js` and D1 writes, and pre-parsed D1 outage fallback.
 */
export async function loadLiveEvents(options: {
  icsUrl: string;
  db?: D1Database | undefined;
  cache?: EventCache | undefined;
  fetcher?: typeof fetch;
  nowMs?: number;
}): Promise<LiveEventsResult> {
  const fetcher = options.fetcher ?? fetch;
  const nowMs = options.nowMs ?? Date.now();
  const cacheKey = new Request(`${options.icsUrl}${PARSED_CACHE_SUFFIX}`);

  const cachedEntries = await readCachedEvents(options.cache, cacheKey);
  if (cachedEntries) return { ok: true, entries: cachedEntries, fromFallback: false };

  const snapshot = await readSnapshot(options.db);
  try {
    const headers = snapshot?.ics_etag ? { 'If-None-Match': snapshot.ics_etag } : undefined;
    const response = await fetcher(options.icsUrl, {
      ...(headers ? { headers } : {}),
      signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS),
    });

    if (response.status === 304 && snapshot?.parsed_json) {
      await writeParsedCache(options.cache, cacheKey, snapshot.parsed_json);
      return {
        ok: true,
        entries: deserializeLiveEvents(snapshot.parsed_json),
        fromFallback: false,
      };
    }
    if (!response.ok) throw new Error(`Calendar feed returned HTTP ${response.status}`);

    const icsText = await response.text();
    const icsSha256 = await sha256Hex(icsText);
    if (snapshot?.ics_sha256 === icsSha256 && snapshot.parsed_json) {
      await writeParsedCache(options.cache, cacheKey, snapshot.parsed_json);
      return {
        ok: true,
        entries: deserializeLiveEvents(snapshot.parsed_json),
        fromFallback: false,
      };
    }

    const { entries } = parseEventsFromIcs(icsText, nowMs);
    const liveEntries = await withStableIds(entries);
    const parsedJson = serializeLiveEvents(liveEntries);
    await writeParsedCache(options.cache, cacheKey, parsedJson);
    await persistSnapshot(options.db, {
      icsSha256,
      icsEtag: response.headers.get('etag'),
      parsedJson,
      icsText,
      nowIso: new Date(nowMs).toISOString(),
      entries: liveEntries,
    });
    return { ok: true, entries: liveEntries, fromFallback: false };
  } catch (error) {
    console.error(`events: live feed load failed: ${String(error)}`);
  }

  return snapshotFallback(snapshot);
}

export async function resolveEventBySlug(
  db: D1Database | undefined,
  entries: readonly LiveEventEntry[],
  slug: string,
): Promise<EventResolution> {
  const direct = entries.find((entry) => entry.slug === slug);
  if (direct) return { kind: 'found', entry: direct };
  if (!db) return { kind: 'not_found' };

  try {
    const row = await db
      .prepare('SELECT stable_id FROM event_slugs WHERE slug = ? LIMIT 1')
      .bind(slug)
      .first<{ stable_id: string }>();
    if (!row) return { kind: 'not_found' };

    const current = entries.find((entry) => entry.stableId === row.stable_id);
    if (current) return { kind: 'redirect', toSlug: current.slug };
    return { kind: 'removed' };
  } catch (error) {
    console.error(`events: slug lookup failed: ${String(error)}`);
    return { kind: 'not_found' };
  }
}

export async function resolveEventByStableId(
  db: D1Database | undefined,
  entries: readonly LiveEventEntry[],
  stableId: string,
): Promise<EventResolution> {
  const current = entries.find((entry) => entry.stableId === stableId);
  if (current) return { kind: 'redirect', toSlug: current.slug };
  if (!db) return { kind: 'not_found' };

  try {
    const row = await db
      .prepare('SELECT slug FROM event_slugs WHERE stable_id = ? LIMIT 1')
      .bind(stableId)
      .first<{ slug: string }>();
    if (row) return { kind: 'removed' };
    return { kind: 'not_found' };
  } catch (error) {
    console.error(`events: stable ID lookup failed: ${String(error)}`);
    return { kind: 'not_found' };
  }
}
