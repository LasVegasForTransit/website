import assert from 'node:assert/strict';
import { test } from 'node:test';
import { programSchema } from '../src/lib/program-schema';

const labs = {
  title: 'LVBT Labs',
  summary: 'Civic tech tools for urbanism and transit advocacy.',
  designation: 'civic-technology',
  icon: 'mdi:flask-outline',
  order: 3,
  status: 'active',
  participationUrl: 'https://labs.lasvegasfortransit.org/',
  participationLabel: 'Explore LVBT Labs',
};

void test('a civic technology program does not require a schedule, venue, or event series', () => {
  const program = programSchema.parse(labs);
  assert.equal(program.cadence, undefined);
  assert.equal(program.venue, undefined);
  assert.equal(program.calendarSeriesUid, undefined);
  assert.equal(program.participationLabel, 'Explore LVBT Labs');
});

void test('event series are optional capabilities of otherwise complete programs', () => {
  const program = programSchema.parse({
    ...labs,
    title: 'Neighborhood walks',
    designation: 'community-gatherings',
    calendarSeriesUid: 'walks@google.com',
    eventNoun: 'walk',
  });
  assert.equal(program.calendarSeriesUid, 'walks@google.com');
  assert.equal(program.cadence, undefined);
  assert.equal(program.eventNoun, 'walk');
});

void test('a participation label requires a destination', () => {
  assert.equal(programSchema.safeParse({ ...labs, participationUrl: undefined }).success, false);
});

void test('program images require descriptive alt text and intrinsic dimensions', () => {
  const image = {
    src: '/programs/transit-mapper.png',
    alt: 'A transit route map in TransitMapper.',
    width: 1200,
    height: 630,
  };
  assert.deepEqual(programSchema.parse({ ...labs, image }).image, image);
  assert.equal(programSchema.safeParse({ ...labs, image: { ...image, alt: '' } }).success, false);
  assert.equal(programSchema.safeParse({ ...labs, image: { ...image, width: 0 } }).success, false);
});
