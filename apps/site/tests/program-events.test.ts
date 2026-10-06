import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  programEventFeature,
  programEventPanel,
  programEventPayload,
  programParticipationAction,
  selectProgramEvent,
} from '../src/lib/program-events';

const seriesUid = '61mlk8dglav98tl5hvdpribpqg@google.com';
const now = new Date('2026-10-04T19:00:00Z');

function event(
  id: string,
  date: string,
  {
    endDate,
    rsvpUrl,
    calendarUid = seriesUid,
    status = 'EventScheduled',
    title = 'Vegas Urbanists',
  }: {
    endDate?: string;
    rsvpUrl?: string;
    calendarUid?: string;
    status?: string;
    title?: string;
  } = {},
) {
  return {
    id,
    data: {
      title,
      calendarUid,
      date: new Date(date),
      endDate: endDate ? new Date(endDate) : undefined,
      rsvpUrl,
      schema: { status },
    },
  };
}

void test('October 15 is selected ahead of November and December, regardless of input order', () => {
  const october = event('2026-10-15-vegas-urbanists', '2026-10-16T01:30:00Z');
  const november = event('2026-11-19-vegas-urbanists', '2026-11-20T02:30:00Z');
  const december = event('2026-12-17-vegas-urbanists', '2026-12-18T02:30:00Z');
  const entries = [december, october, november];

  assert.equal(selectProgramEvent(entries, seriesUid, now), october);
  assert.deepEqual(entries, [december, october, november]);
});

void test('an ongoing meetup takes precedence over the next upcoming one', () => {
  const ongoing = event('ongoing', '2026-10-16T01:30:00Z', {
    endDate: '2026-10-16T03:00:00Z',
  });
  const upcoming = event('upcoming', '2026-11-20T02:30:00Z');

  assert.equal(
    selectProgramEvent([upcoming, ongoing], seriesUid, new Date('2026-10-16T02:15:00Z')),
    ongoing,
  );
  assert.equal(
    selectProgramEvent([ongoing, upcoming], seriesUid, new Date('2026-10-16T03:01:00Z')),
    upcoming,
  );
});

void test('meetups without an end date use the shared one-hour ongoing window', () => {
  const ongoing = event('ongoing', '2026-10-16T01:30:00Z');
  const upcoming = event('upcoming', '2026-11-20T02:30:00Z');

  assert.equal(
    selectProgramEvent([upcoming, ongoing], seriesUid, new Date('2026-10-16T02:00:00Z')),
    ongoing,
  );
  assert.equal(
    selectProgramEvent([upcoming, ongoing], seriesUid, new Date('2026-10-16T02:31:00Z')),
    upcoming,
  );
});

void test('the most recently completed meetup is the fallback when nothing is scheduled', () => {
  const october = event('october', '2026-10-16T01:30:00Z');
  const november = event('november', '2026-11-20T02:30:00Z');

  assert.equal(
    selectProgramEvent([november, october], seriesUid, new Date('2026-12-01T19:00:00Z')),
    november,
  );
});

void test('cancelled occurrences are excluded from ongoing, upcoming, and completed choices', () => {
  const completed = event('completed', '2026-09-18T01:30:00Z');
  const cancelled = event('cancelled', '2026-10-16T01:30:00Z', { status: 'EventCancelled' });
  const upcoming = event('upcoming', '2026-11-20T02:30:00Z');

  for (const at of [now, new Date('2026-10-16T02:00:00Z'), new Date('2026-10-17T19:00:00Z')]) {
    assert.equal(selectProgramEvent([cancelled, completed, upcoming], seriesUid, at), upcoming);
    assert.equal(selectProgramEvent([cancelled, completed], seriesUid, at), completed);
  }
  assert.equal(selectProgramEvent([cancelled], seriesUid, now), undefined);
});

void test('renamed and rescheduled occurrences stay connected by series UID', () => {
  const unrelated = event('same-title-other-series', '2026-10-10T01:30:00Z', {
    calendarUid: 'other-series@google.com',
  });
  const moved = event('2026-10-22-neighborhood-night', '2026-10-23T02:00:00Z', {
    title: 'Neighborhood night',
  });
  const november = event('november', '2026-11-20T02:30:00Z');

  assert.equal(selectProgramEvent([unrelated, november, moved], seriesUid, now), moved);
});

void test('programs without a series or matching occurrences have no selected event', () => {
  const entries = [event('october', '2026-10-16T01:30:00Z')];

  assert.equal(selectProgramEvent(entries, undefined, now), undefined);
  assert.equal(selectProgramEvent(entries, 'missing@google.com', now), undefined);
  assert.equal(selectProgramEvent<(typeof entries)[number]>([], seriesUid, now), undefined);
});

void test('RSVP always links to the selected LVBT event page, including when a signup URL exists', () => {
  const meetup = event('2026-10-15-vegas-urbanists', '2026-10-16T01:30:00Z', {
    endDate: '2026-10-16T03:00:00Z',
    rsvpUrl: 'https://events.example.org/urbanists',
  });
  for (const at of [now, new Date('2026-10-16T02:00:00Z')]) {
    assert.deepEqual(programParticipationAction({}, meetup, at), {
      href: '/events/2026-10-15-vegas-urbanists/',
      label: 'RSVP',
      external: false,
    });
  }
});

void test('an upcoming meetup without a signup URL still offers RSVP at the LVBT event page', () => {
  const meetup = event('2026-10-15-vegas-urbanists', '2026-10-16T01:30:00Z');

  assert.deepEqual(programParticipationAction({}, meetup, now), {
    href: '/events/2026-10-15-vegas-urbanists/',
    label: 'RSVP',
    external: false,
  });
});

void test('an ongoing meetup without a signup URL also offers RSVP at the LVBT event page', () => {
  const meetup = event('2026-10-15-vegas-urbanists', '2026-10-16T01:30:00Z');

  assert.deepEqual(programParticipationAction({}, meetup, new Date('2026-10-16T02:00:00Z')), {
    href: '/events/2026-10-15-vegas-urbanists/',
    label: 'RSVP',
    external: false,
  });
});

void test('a completed meetup links to its record even when it retains an old signup URL', () => {
  const meetup = event('2026-10-15-vegas-urbanists', '2026-10-16T01:30:00Z', {
    rsvpUrl: 'https://events.example.org/urbanists',
  });

  assert.deepEqual(
    programParticipationAction({ eventNoun: 'meetup' }, meetup, new Date('2026-10-17T19:00:00Z')),
    {
      href: '/events/2026-10-15-vegas-urbanists/',
      label: 'View last meetup',
      external: false,
    },
  );
});

void test('without any occurrence, an event series keeps the events calendar available', () => {
  assert.deepEqual(programParticipationAction({ calendarSeriesUid: seriesUid }, undefined, now), {
    href: '/events',
    label: 'Events calendar',
    external: false,
  });
});

void test('programs without event or participation capabilities do not acquire a calendar action', () => {
  assert.equal(programParticipationAction({}, undefined, now), undefined);
});

void test('a civic technology program uses its own participation label and destination', () => {
  assert.deepEqual(
    programParticipationAction(
      {
        participationUrl: 'https://labs.lasvegasfortransit.org/',
        participationLabel: 'Explore LVBT Labs',
      },
      undefined,
      now,
    ),
    {
      href: 'https://labs.lasvegasfortransit.org/',
      label: 'Explore LVBT Labs',
      external: true,
    },
  );
});

void test('event wording follows the program rather than assuming every event is a meetup', () => {
  const walk = event('walk', '2026-10-16T01:30:00Z');
  assert.equal(programEventPanel({ eventNoun: 'walk' }, walk, now).heading, 'Next walk');
  assert.equal(programEventPanel({}, walk, now).heading, 'Next event');
  assert.equal(
    programEventPanel({ eventNoun: 'walk' }, walk, new Date('2026-10-17T19:00:00Z')).action?.label,
    'View last walk',
  );
});

void test('the event panel rolls from upcoming to ongoing to the next occurrence with its actual venue', () => {
  const october = {
    ...event('october', '2026-10-16T01:30:00Z', { endDate: '2026-10-16T03:00:00Z' }),
    data: {
      ...event('october', '2026-10-16T01:30:00Z', { endDate: '2026-10-16T03:00:00Z' }).data,
      location: {
        format: 'in-person' as const,
        venue: {
          name: 'October cafe',
          addressLocality: 'Las Vegas',
          addressRegion: 'NV',
          addressCountry: 'US',
        },
      },
    },
  };
  const november = {
    ...event('november', '2026-11-20T02:30:00Z'),
    data: {
      ...event('november', '2026-11-20T02:30:00Z').data,
      location: { format: 'virtual' as const, joinUrl: 'https://meet.google.com/example' },
    },
  };
  const program = { calendarSeriesUid: seriesUid, eventNoun: 'meetup' };
  const occurrences = [october, november];
  for (const [at, heading, href, venue] of [
    [now, 'Next meetup', '/events/october/', 'October cafe'],
    [new Date('2026-10-16T02:00:00Z'), 'Happening now', '/events/october/', 'October cafe'],
    [new Date('2026-10-16T03:01:00Z'), 'Next meetup', '/events/november/', 'Online'],
  ] as const) {
    const selected = selectProgramEvent(occurrences, seriesUid, at);
    const panel = programEventPanel(program, selected, at);
    assert.equal(panel.heading, heading);
    assert.equal(panel.action?.href, href);
    assert.equal(panel.venue?.name, venue);
  }
});

void test('an event without a venue never inherits the program standing venue', () => {
  const panel = programEventPanel(
    {
      venue: {
        name: 'Standing cafe',
        address: 'Example street',
        mapUrl: 'https://maps.example.org/',
        status: 'confirmed',
      },
    },
    event('october', '2026-10-16T01:30:00Z'),
    now,
  );
  assert.equal(panel.venue?.name, 'Location to be announced');
});

void test('a program participant site takes precedence over meetup actions', () => {
  const meetup = event('october', '2026-10-16T01:30:00Z', {
    rsvpUrl: 'https://events.example.org/urbanists',
  });

  assert.deepEqual(
    programParticipationAction({ participationUrl: 'https://lvwwd.org/' }, meetup, now),
    {
      href: 'https://lvwwd.org/',
      label: 'Visit lvwwd.org',
      external: true,
    },
  );
});

void test('the directory feature rolls its topic and RSVP to the selected occurrence', () => {
  const october = {
    ...event('october', '2026-10-16T01:30:00Z', { endDate: '2026-10-16T03:00:00Z' }),
    data: {
      ...event('october', '2026-10-16T01:30:00Z', { endDate: '2026-10-16T03:00:00Z' }).data,
      discussionTopic: 'What makes a neighborhood walkable?',
    },
  };
  const november = event('november', '2026-11-20T02:30:00Z');
  const program = { calendarSeriesUid: seriesUid, eventNoun: 'meetup' };
  const first = programEventFeature(
    program,
    selectProgramEvent([november, october], seriesUid, now),
    now,
  );
  assert.equal(first.headline, october.data.discussionTopic);
  assert.equal(first.dateLabel, 'Thursday, October 15');
  assert.equal(first.timeLabel, '6:30 p.m.');
  assert.equal(first.action?.href, '/events/october/');
  assert.equal(first.printUrl, 'lasvegasfortransit.org/events/october');

  const afterOctober = new Date('2026-10-16T03:01:00Z');
  const next = programEventFeature(
    program,
    selectProgramEvent([october, november], seriesUid, afterOctober),
    afterOctober,
  );
  assert.equal(next.headline, 'Thursday, November 19');
  assert.equal(next.dateLabel, undefined);
  assert.equal(next.timeLabel, '6:30 p.m.');
  assert.equal(next.action?.href, '/events/november/');
  assert.equal(next.printUrl, 'lasvegasfortransit.org/events/november');
});

void test('the directory feature uses the recurring schedule when no occurrence exists', () => {
  const feature = programEventFeature(
    { calendarSeriesUid: seriesUid, cadence: 'Third Thursdays at 6:30 p.m.' },
    undefined,
    now,
  );
  assert.equal(feature.heading, 'Schedule');
  assert.equal(feature.headline, 'Third Thursdays at 6:30 p.m.');
  assert.equal(feature.timeLabel, undefined);
  assert.equal(feature.action?.href, '/events');
  assert.equal(feature.action.label, 'Events calendar');
});

void test('serialized program events contain only their series and escape authored markup', () => {
  const authored = {
    ...event('october', '2026-10-16T01:30:00Z'),
    data: {
      ...event('october', '2026-10-16T01:30:00Z').data,
      discussionTopic: '</script><p>A question</p>',
    },
  };
  const payload = programEventPayload({ calendarSeriesUid: seriesUid }, [
    authored,
    event('other', '2026-10-16T01:30:00Z', { calendarUid: 'other' }),
  ]);
  assert.equal(payload.includes('<'), false);
  const decoded = JSON.parse(payload) as { events: (typeof authored)[] };
  assert.deepEqual(
    decoded.events.map(({ id }) => id),
    ['october'],
  );
  assert.equal(decoded.events[0]?.data.discussionTopic, authored.data.discussionTopic);
});
