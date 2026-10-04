import assert from 'node:assert/strict';
import test from 'node:test';
import { groupCampaignEvents } from '../src/lib/campaigns/event-schedule';

const events = [
  { slug: 'december', start: '2026-12-05T14:00:00-08:00' },
  { slug: 'topic', proposed: true, start: '2026-10-01T14:00:00-07:00' },
  { slug: 'october', start: '2026-10-17T14:00:00-07:00', end: '2026-10-17T16:00:00-07:00' },
  { slug: 'november', start: '2026-11-07T14:00:00-08:00' },
  { slug: 'undated' },
];

void test('features the nearest confirmed gathering and keeps proposed topics separate', () => {
  const groups = groupCampaignEvents(events, new Date('2026-10-17T22:59:59Z'));
  assert.deepEqual(
    groups.upcoming.map((event) => event.slug),
    ['october', 'november', 'december'],
  );
  assert.deepEqual(
    groups.proposed.map((event) => event.slug),
    ['topic', 'undated'],
  );
  assert.deepEqual(groups.past, []);
});

void test('moves completed gatherings into history and advances the next gathering', () => {
  const groups = groupCampaignEvents(events, new Date('2026-11-08T08:00:00Z'));
  assert.deepEqual(
    groups.upcoming.map((event) => event.slug),
    ['december'],
  );
  assert.deepEqual(
    groups.past.map((event) => event.slug),
    ['november', 'october'],
  );
});

void test('uses an explicit end time without archiving a gathering that is still happening', () => {
  assert.deepEqual(
    groupCampaignEvents(events, new Date('2026-10-17T23:00:00Z')).past.map((e) => e.slug),
    ['october'],
  );
});

void test('keeps a gathering without an end time visible through its Las Vegas calendar day', () => {
  const event = [{ slug: 'listening', start: '2026-10-17T14:00:00-07:00' }];
  assert.equal(groupCampaignEvents(event, new Date('2026-10-18T06:59:59Z')).upcoming.length, 1);
  assert.equal(groupCampaignEvents(event, new Date('2026-10-18T07:00:00Z')).past.length, 1);
});

void test('does not feature an event with an invalid date', () => {
  const groups = groupCampaignEvents(
    [{ slug: 'bad', start: 'not-a-date' }],
    new Date('2026-10-04T12:00:00Z'),
  );
  assert.deepEqual(groups.upcoming, []);
  assert.deepEqual(
    groups.proposed.map((event) => event.slug),
    ['bad'],
  );
});
