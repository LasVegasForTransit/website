import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectEventBody } from '../src/lib/event-bodies';

const body = {
  id: '2026-10-15-vegas-urbanist-social-club',
  data: { calendarOccurrenceId: 'series@google.com#2026-10-15T18:30:00' },
};

void test('authored event copy survives a rename and reschedule through occurrence identity', () => {
  assert.equal(
    selectEventBody([body], {
      id: '2026-10-22-neighborhood-conversation',
      data: { calendarOccurrenceId: body.data.calendarOccurrenceId },
    }),
    body,
  );
});

void test('occurrence-specific copy never attaches to another month or another series', () => {
  for (const calendarOccurrenceId of [
    'series@google.com#2026-11-19T18:30:00',
    'other@google.com#2026-10-15T18:30:00',
  ]) {
    assert.equal(
      selectEventBody([body], { id: body.id, data: { calendarOccurrenceId } }),
      undefined,
    );
  }
});

void test('existing event bodies without an occurrence identity still match their filename', () => {
  const legacy = { id: '2026-10-15-event', data: {} };
  assert.equal(
    selectEventBody([legacy], {
      id: legacy.id,
      data: { calendarOccurrenceId: 'one-off@google.com' },
    }),
    legacy,
  );
});
