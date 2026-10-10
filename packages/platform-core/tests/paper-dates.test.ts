import assert from 'node:assert/strict';
import test from 'node:test';
void test('paper date boundaries use Pacific midnight on both daylight-saving transition days', async () => {
  const paper = await import('../src/paper');
  assert.equal(typeof paper.paperDayStarts, 'function');
  for (const [day, midnight] of [
    ['2026-03-08', '2026-03-08T08:00:00.000Z'],
    ['2026-11-01', '2026-11-01T07:00:00.000Z'],
    ['2026-10-03', '2026-10-03T07:00:00.000Z'],
    ['2026-01-03', '2026-01-03T08:00:00.000Z'],
  ] as const)
    assert.equal(paper.paperDayStarts(day), midnight);
});
