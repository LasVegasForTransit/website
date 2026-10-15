import assert from 'node:assert/strict';
import test from 'node:test';
import { memberPrivacySchedule } from '../src/member-privacy-schedule';

void test('the daily Pacific run starts at 03:00 through both daylight-saving transitions', () => {
  for (const [before, at, day] of [
    ['2026-03-08T09:59:59Z', '2026-03-08T10:00:00Z', '2026-03-08'],
    ['2026-11-01T10:59:59Z', '2026-11-01T11:00:00Z', '2026-11-01'],
    ['2026-03-07T10:59:59Z', '2026-03-07T11:00:00Z', '2026-03-07'],
    ['2026-10-31T09:59:59Z', '2026-10-31T10:00:00Z', '2026-10-31'],
  ] as const) {
    assert.equal(memberPrivacySchedule(new Date(before)), null);
    assert.equal(memberPrivacySchedule(new Date(at))?.day, day);
  }
});
void test('the eighteen-calendar-month cutoff preserves Pacific03:00 and clamps short months', () => {
  assert.deepEqual(memberPrivacySchedule(new Date('2026-08-31T10:00:00Z')), {
    day: '2026-08-31',
    cutoff: '2025-02-28T11:00:00.000Z',
  });
  assert.equal(
    memberPrivacySchedule(new Date('2025-08-31T10:00:00Z'))?.cutoff,
    '2024-02-29T11:00:00.000Z',
  );
  assert.equal(
    memberPrivacySchedule(new Date('2026-10-14T22:05:00Z'))?.cutoff,
    '2025-04-14T10:00:00.000Z',
  );
});
