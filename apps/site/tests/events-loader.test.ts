import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { calendarEventsLoader } from '../src/lib/events-loader';
import { selectProgramEvent } from '../src/lib/program-events';

const seriesUid = '61mlk8dglav98tl5hvdpribpqg@google.com';
const now = new Date('2026-10-04T19:00:00Z');
type LoaderContext = Parameters<ReturnType<typeof calendarEventsLoader>['load']>[0];
type StoredEntry = Parameters<LoaderContext['store']['set']>[0];

function calendar(exceptionStatus: 'CONFIRMED' | 'CANCELLED') {
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//LVBT//Calendar test//EN
BEGIN:VEVENT
UID:${seriesUid}
SUMMARY:Vegas Urbanists
DTSTART:20261015T183000Z
DTEND:20261015T200000Z
RRULE:FREQ=MONTHLY;COUNT=3;BYDAY=3TH
STATUS:CONFIRMED
LOCATION:Original cafe
END:VEVENT
BEGIN:VEVENT
UID:${seriesUid}
RECURRENCE-ID:20261015T183000Z
SUMMARY:Neighborhood night
DTSTART:20261022T190000Z
DTEND:20261022T203000Z
STATUS:${exceptionStatus}
LOCATION:New cafe
END:VEVENT
END:VCALENDAR`;
}

async function loadCalendar() {
  const entries: StoredEntry[] = [];
  await calendarEventsLoader().load({
    store: {
      clear: () => {
        entries.length = 0;
      },
      set: (entry: StoredEntry) => {
        entries.push(entry);
        return true;
      },
    },
    parseData: ({ data }: { data: Record<string, unknown> }) => Promise.resolve(data),
    generateDigest: (input: string) => createHash('sha256').update(input).digest('hex'),
    logger: { info: () => {} },
  } as unknown as LoaderContext);
  return entries;
}

void test('calendar loading retains series UID and the renamed, rescheduled occurrence details', async (t) => {
  t.mock.method(Date, 'now', () => now.getTime());
  t.mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(calendar('CONFIRMED'))));

  const entries = await loadCalendar();
  assert.equal(entries.length, 3);
  assert.ok(entries.every((entry) => entry.data.calendarUid === seriesUid));
  const moved = entries.find((entry) => entry.id === '2026-10-22-neighborhood-night');
  assert.ok(moved);
  assert.equal(moved.data.title, 'Neighborhood night');
  assert.equal(moved.data.calendarOccurrenceId, `${seriesUid}#2026-10-15T18:30:00Z`);
  assert.equal((moved.data.date as Date).toISOString(), '2026-10-22T19:00:00.000Z');
  assert.equal((moved.data.location as { venue: { name: string } }).venue.name, 'New cafe');
  assert.equal((moved.data.schema as { status: string }).status, 'EventScheduled');
  assert.equal(moved.data.featured, true);
  assert.ok(!entries.some((entry) => entry.id === '2026-10-15-vegas-urbanists'));
});

void test('cancelled calendar exceptions retain their status, change their digest, and are not selected', async (t) => {
  t.mock.method(Date, 'now', () => now.getTime());
  let status: 'CONFIRMED' | 'CANCELLED' = 'CONFIRMED';
  t.mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(calendar(status))));
  const scheduled = await loadCalendar();
  status = 'CANCELLED';
  const cancelled = await loadCalendar();
  const moved = cancelled.find((entry) => entry.id === '2026-10-22-neighborhood-night');
  assert.ok(moved);
  assert.equal((moved.data.schema as { status: string }).status, 'EventCancelled');
  assert.notEqual(moved.digest, scheduled.find((entry) => entry.id === moved.id)?.digest);
  assert.equal(moved.data.featured, false);

  const occurrences = cancelled.map((entry) => ({
    id: entry.id,
    data: entry.data as {
      calendarUid: string;
      date: Date;
      endDate?: Date;
      schema?: { status?: string };
    },
  }));
  assert.equal(selectProgramEvent(occurrences, seriesUid, now)?.id, '2026-11-19-vegas-urbanists');
});

for (const [format, description, summary, body, rsvpUrl] of [
  [
    'Google Calendar line breaks',
    'Monthly social to discuss the city.<br><br>RSVP here: <a href="https://example.org/rsvp?event=1&amp;ref=calendar">Register</a>',
    'Monthly social to discuss the city.',
    'RSVP here: <a href="https://example.org/rsvp?event=1&amp;ref=calendar">Register</a>',
    'https://example.org/rsvp?event=1&ref=calendar',
  ],
  [
    'HTML paragraphs',
    '<p><strong>Neighborhood news &amp; conversation.</strong></p><p>Bring a question.</p>',
    'Neighborhood news & conversation.',
    '<p>Bring a question.</p>',
    undefined,
  ],
  [
    'plain-text paragraphs',
    String.raw`Neighborhood news and conversation.\n\nBring a question.`,
    'Neighborhood news and conversation.',
    'Bring a question.',
    undefined,
  ],
  [
    'plain-text RSVP links',
    String.raw`Monthly social.\n\nRSVP: https://example.org/rsvp`,
    'Monthly social.',
    'RSVP: https://example.org/rsvp',
    'https://example.org/rsvp',
  ],
  [
    'linked RSVP labels in HTML paragraphs',
    '<p>Monthly social.</p><p>RSVP: <a class="registration" href=\'https://example.org/rsvp\'>Register</a></p>',
    'Monthly social.',
    '<p>RSVP: <a class="registration" href=\'https://example.org/rsvp\'>Register</a></p>',
    'https://example.org/rsvp',
  ],
]) {
  void test(`calendar descriptions separate the summary from the body with ${format}`, async (t) => {
    t.mock.method(Date, 'now', () => now.getTime());
    const feed = calendar('CONFIRMED').replace(
      'LOCATION:New cafe',
      `LOCATION:New cafe\nDESCRIPTION:${description}`,
    );
    t.mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(feed)));

    const entries = await loadCalendar();
    const moved = entries.find((entry) => entry.id === '2026-10-22-neighborhood-night');
    assert.ok(moved);
    assert.equal(moved.data.summary, summary);
    assert.equal(moved.data.body, body);
    assert.equal(moved.data.rsvpUrl, rsvpUrl);
  });
}
