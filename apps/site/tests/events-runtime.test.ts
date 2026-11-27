import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SESSION_COOKIE } from '@lasvegasfortransit/platform-core/web-auth';
import {
  eventCacheControl,
  PUBLIC_EVENT_CACHE_CONTROL,
  withAnonymousResponseCache,
} from '../functions/events/_shared';
import { selectEventBody } from '../src/lib/event-bodies';
import { EVENT_LEGACY_REDIRECTS } from '../src/lib/event-legacy-redirects';
import { stableEventId } from '../src/lib/event-stable-id';
import {
  deserializeLiveEvents,
  loadLiveEvents,
  resolveEventBySlug,
  resolveEventByStableId,
  serializeLiveEvents,
  type EventCache,
} from '../src/lib/events-live';
import {
  renderEventDetail,
  renderEventRemoved,
  renderEventsIndexBody,
  renderEventsUnavailable,
} from '../src/lib/events-render';

const siteDir = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const migrationSql = await readFile(
  path.resolve(siteDir, '../../packages/platform-storage/migrations/0067_event_slugs.sql'),
  'utf8',
);

function memoryD1(): D1Database {
  const raw = new DatabaseSync(':memory:');
  raw.exec(migrationSql);

  class Prepared {
    constructor(
      private readonly sql: string,
      private readonly args: unknown[] = [],
    ) {}
    bind(...values: unknown[]): D1PreparedStatement {
      return new Prepared(this.sql, values);
    }
    first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
      const stmt = raw.prepare(this.sql);
      const row = stmt.get(...(this.args as (string | number | null)[])) as
        Record<string, unknown> | undefined;
      if (!row) return Promise.resolve(null);
      if (colName) return Promise.resolve((row[colName] as T) ?? null);
      return Promise.resolve(row as T);
    }
    run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      raw.prepare(this.sql).run(...(this.args as (string | number | null)[]));
      return Promise.resolve({
        success: true,
        results: [],
        meta: {
          duration: 0,
          size_after: 0,
          rows_read: 0,
          rows_written: 0,
          last_row_id: 0,
          changed_db: true,
          changes: 0,
        },
      });
    }
    all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      const rows = raw.prepare(this.sql).all(...(this.args as (string | number | null)[])) as T[];
      return Promise.resolve({
        success: true,
        results: rows,
        meta: {
          duration: 0,
          size_after: 0,
          rows_read: rows.length,
          rows_written: 0,
          last_row_id: 0,
          changed_db: false,
          changes: 0,
        },
      });
    }
    raw = (() => Promise.resolve([])) as unknown as D1PreparedStatement['raw'];
  }

  return {
    prepare(query: string) {
      return new Prepared(query);
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const out: D1Result<T>[] = [];
      for (const stmt of statements) out.push(await stmt.run<T>());
      return out;
    },
    exec(query: string) {
      raw.exec(query);
      return Promise.resolve({ count: 1, duration: 0 });
    },
  } as unknown as D1Database;
}

function makeCache(): EventCache {
  const store = new Map<string, Response>();
  return {
    match(req) {
      const hit = store.get(req.url);
      return Promise.resolve(hit ? hit.clone() : undefined);
    },
    put(req, res) {
      store.set(req.url, res.clone());
      return Promise.resolve();
    },
  };
}

function sampleIcs(title: string, startUtc = '20261115T010000Z', uid = 'evt-1@google.com') {
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//LVBT//Test//EN
BEGIN:VEVENT
UID:${uid}
SUMMARY:${title}
DTSTART:${startUtc}
DTEND:20261115T023000Z
STATUS:CONFIRMED
LOCATION:Online
DESCRIPTION:First paragraph summary.\\n\\nSecond paragraph body.
END:VEVENT
END:VCALENDAR`;
}

void test('stableEventId stays invariant across title or date edits for one occurrence ID', async () => {
  const idA = await stableEventId('series@google.com#2026-10-15T18:30:00');
  const idB = await stableEventId('series@google.com#2026-10-15T18:30:00');
  const idOther = await stableEventId('series@google.com#2026-11-15T18:30:00');
  assert.equal(idA, idB);
  assert.notEqual(idA, idOther);
  assert.match(idA, /^[a-z2-7]{10}$/);
});

void test('loadLiveEvents caches parsed JSON and skips D1 writes on 304 and hash match', async () => {
  const icsUrl = 'https://calendar.example.test/feed.ics';
  const db = memoryD1();
  const cache = makeCache();
  let fetchCount = 0;

  const first = await loadLiveEvents({
    icsUrl,
    db,
    cache,
    nowMs: Date.parse('2026-11-10T00:00:00Z'),
    fetcher: () => {
      fetchCount += 1;
      return Promise.resolve(
        new Response(sampleIcs('Transit Meetup'), { status: 200, headers: { ETag: '"v1"' } }),
      );
    },
  });
  assert.ok(first.ok);
  const firstEntry = first.entries[0];
  assert.ok(firstEntry);
  assert.equal(first.fromFallback, false);
  assert.equal(firstEntry.slug, '2026-11-14-transit-meetup');
  assert.equal(firstEntry.data.date instanceof Date, true);
  assert.equal(fetchCount, 1);

  const cachedHit = await loadLiveEvents({
    icsUrl,
    db,
    cache,
    nowMs: Date.parse('2026-11-10T00:02:00Z'),
    fetcher: () => Promise.reject(new Error('should not fetch while edge cache is warm')),
  });
  assert.ok(cachedHit.ok);
  assert.equal(fetchCount, 1);

  const readsOnlyDb = {
    prepare(query: string) {
      if (query.startsWith('INSERT') || query.includes('event_slugs')) {
        throw new Error(`Unexpected DB write/scan query: ${query}`);
      }
      return db.prepare(query);
    },
    batch: () => Promise.reject(new Error('Unexpected DB batch write')),
    exec: db.exec.bind(db),
  } as unknown as D1Database;

  let seenIfNoneMatch: string | null = null;
  const notModified = await loadLiveEvents({
    icsUrl,
    db: readsOnlyDb,
    cache: makeCache(),
    nowMs: Date.parse('2026-11-10T00:06:00Z'),
    fetcher: (_input, init) => {
      seenIfNoneMatch = new Headers(init?.headers).get('If-None-Match');
      return Promise.resolve(new Response(null, { status: 304 }));
    },
  });
  assert.equal(seenIfNoneMatch, '"v1"');
  assert.ok(notModified.ok);

  const unchangedHash = await loadLiveEvents({
    icsUrl,
    db: readsOnlyDb,
    cache: makeCache(),
    nowMs: Date.parse('2026-11-10T00:08:00Z'),
    fetcher: () => Promise.resolve(new Response(sampleIcs('Transit Meetup'), { status: 200 })),
  });
  assert.ok(unchangedHash.ok);

  const roundTripped = deserializeLiveEvents(serializeLiveEvents(first.entries));
  const roundTrippedEntry = roundTripped[0];
  assert.ok(roundTrippedEntry);
  assert.equal(roundTrippedEntry.data.date.toISOString(), firstEntry.data.date.toISOString());
});

void test('loadLiveEvents falls back to D1 snapshot on outage and fails cleanly when cold', async () => {
  const icsUrl = 'https://calendar.example.test/feed.ics';
  const db = memoryD1();
  await loadLiveEvents({
    icsUrl,
    db,
    cache: makeCache(),
    nowMs: Date.parse('2026-11-10T00:00:00Z'),
    fetcher: () => Promise.resolve(new Response(sampleIcs('Transit Meetup'), { status: 200 })),
  });

  const fallback = await loadLiveEvents({
    icsUrl,
    db,
    cache: makeCache(),
    nowMs: Date.parse('2026-11-10T00:10:00Z'),
    fetcher: () => Promise.resolve(new Response('upstream error', { status: 503 })),
  });
  assert.ok(fallback.ok);
  assert.equal(fallback.fromFallback, true);
  assert.equal(fallback.entries[0]?.slug, '2026-11-14-transit-meetup');

  const coldUnavailable = await loadLiveEvents({
    icsUrl,
    db: memoryD1(),
    cache: makeCache(),
    nowMs: Date.parse('2026-11-10T00:10:00Z'),
    fetcher: () => Promise.reject(new Error('network down')),
  });
  assert.deepEqual(coldUnavailable, { ok: false, reason: 'unavailable' });
});

void test('renamed and deleted events resolve to 301 redirects, stable ID redirects, 410 removed, and 404 unknown', async () => {
  const icsUrl = 'https://calendar.example.test/feed.ics';
  const db = memoryD1();
  const nowMs = Date.parse('2026-11-10T00:00:00Z');

  const initial = await loadLiveEvents({
    icsUrl,
    db,
    cache: makeCache(),
    nowMs,
    fetcher: () => Promise.resolve(new Response(sampleIcs('Initial Name'), { status: 200 })),
  });
  assert.ok(initial.ok);
  const stableId = initial.entries[0]?.stableId ?? '';

  const renamed = await loadLiveEvents({
    icsUrl,
    db,
    cache: makeCache(),
    nowMs,
    fetcher: () =>
      Promise.resolve(
        new Response(sampleIcs('Renamed Event', '20261116T010000Z'), { status: 200 }),
      ),
  });
  assert.ok(renamed.ok);

  assert.deepEqual(await resolveEventBySlug(db, renamed.entries, '2026-11-14-initial-name'), {
    kind: 'redirect',
    toSlug: '2026-11-15-renamed-event',
  });
  assert.deepEqual(await resolveEventByStableId(db, renamed.entries, stableId), {
    kind: 'redirect',
    toSlug: '2026-11-15-renamed-event',
  });
  assert.deepEqual(await resolveEventBySlug(db, renamed.entries, 'never-existed-slug'), {
    kind: 'not_found',
  });
  assert.deepEqual(await resolveEventBySlug(db, [], '2026-11-14-initial-name'), {
    kind: 'removed',
  });
  assert.deepEqual(await resolveEventByStableId(db, [], stableId), { kind: 'removed' });
});

void test('eventCacheControl and withAnonymousResponseCache cache anonymous 200/301 responses and bypass sessions', async () => {
  const anonymous = new Request('https://lasvegasfortransit.org/events/');
  assert.equal(eventCacheControl(anonymous), PUBLIC_EVENT_CACHE_CONTROL);

  const signedIn = new Request('https://lasvegasfortransit.org/events/', {
    headers: { Cookie: `${SESSION_COOKIE}=session-token` },
  });
  assert.equal(eventCacheControl(signedIn), 'private, no-store');

  const cache = makeCache();
  let renders = 0;
  const firstAnon = await withAnonymousResponseCache(
    anonymous,
    () => Promise.resolve(new Response(`render-${++renders}`, { status: 200 })),
    cache,
  );
  assert.equal(await firstAnon.text(), 'render-1');

  const secondAnon = await withAnonymousResponseCache(
    anonymous,
    () => Promise.resolve(new Response(`render-${++renders}`, { status: 200 })),
    cache,
  );
  assert.equal(await secondAnon.text(), 'render-1');
  assert.equal(renders, 1);

  const memberRes = await withAnonymousResponseCache(
    signedIn,
    () => Promise.resolve(new Response(`member-${++renders}`, { status: 200 })),
    cache,
  );
  assert.equal(await memberRes.text(), 'member-2');

  const notFoundReq = new Request('https://lasvegasfortransit.org/events/missing/');
  await withAnonymousResponseCache(
    notFoundReq,
    () => Promise.resolve(new Response('not found', { status: 404 })),
    cache,
  );
  let missedRenders = 0;
  await withAnonymousResponseCache(
    notFoundReq,
    () => {
      missedRenders += 1;
      return Promise.resolve(new Response('not found again', { status: 404 }));
    },
    cache,
  );
  assert.equal(missedRenders, 1);
});

void test('EVENT_LEGACY_REDIRECTS covers every /events rule declared in public/_redirects', async () => {
  const raw = await readFile(path.join(siteDir, 'public', '_redirects'), 'utf8');
  for (const line of raw.split('\n')) {
    const [source, destination] = line.trim().split(/\s+/);
    if (!source?.startsWith('/events/') || !destination) continue;
    const normalized = source.replace(/^\/events\//, '').replace(/\/$/, '');
    assert.equal(EVENT_LEGACY_REDIRECTS[normalized], destination);
  }
});

void test('event renderers escape untrusted text and support MDX override precedence and 410/503 views', async () => {
  const result = await loadLiveEvents({
    icsUrl: 'https://calendar.example.test/feed.ics',
    cache: makeCache(),
    nowMs: Date.parse('2026-11-10T00:00:00Z'),
    fetcher: () =>
      Promise.resolve(
        new Response(sampleIcs('Bus <script>alert(1)</script> Forum'), { status: 200 }),
      ),
  });
  assert.ok(result.ok);

  const entry = result.entries[0];
  assert.ok(entry);
  const override = selectEventBody(
    [{ id: 'override', data: { calendarOccurrenceId: entry.data.calendarOccurrenceId } }],
    { id: entry.slug, data: { calendarOccurrenceId: entry.data.calendarOccurrenceId } },
  );
  assert.equal(override?.id, 'override');

  const detailHtml = renderEventDetail(
    entry,
    '<p>MDX override content</p>',
    'https://lasvegasfortransit.org/events/test/',
    new Date('2026-11-10T00:00:00Z'),
  );
  assert.match(detailHtml, /Bus &lt;script&gt;alert\(1\)&lt;\/script&gt; Forum/);
  assert.match(detailHtml, /<p>MDX override content<\/p>/);
  assert.match(
    renderEventsIndexBody(result.entries, new Date('2026-11-10T00:00:00Z')),
    /Next event/,
  );
  assert.match(renderEventRemoved(), /This event is no longer on LVBT's calendar\./);
  assert.match(renderEventsUnavailable(), /Events are taking a moment to load/);
});

void test('all-day VALUE=DATE events anchor to Pacific Time midnight regardless of host timezone', async () => {
  const allDayIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//LVBT//Test//EN
BEGIN:VEVENT
UID:all-day@google.com
SUMMARY:Clean Air Day
DTSTART;VALUE=DATE:20261007
DTEND;VALUE=DATE:20261008
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;

  const result = await loadLiveEvents({
    icsUrl: 'https://calendar.example.test/all-day.ics',
    cache: makeCache(),
    nowMs: Date.parse('2026-10-01T00:00:00Z'),
    fetcher: () => Promise.resolve(new Response(allDayIcs, { status: 200 })),
  });
  assert.ok(result.ok);
  const allDayEntry = result.entries[0];
  assert.ok(allDayEntry);
  assert.equal(allDayEntry.slug, '2026-10-07-clean-air-day');
  assert.equal(allDayEntry.data.date.toISOString(), '2026-10-07T07:00:00.000Z');
});
