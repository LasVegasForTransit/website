import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';

void test('Google quota pauses survive runner recreation and remain isolated by customer', async () => {
  const loaded = await import('../src/google-rate-limit').catch(() => null);
  assert.ok(loaded, 'Google retries need a persisted customer-wide quota pause');
  const db = memoryDb();
  const firstNow = new Date('2026-10-09T12:00:00.000Z');
  const first = loaded.googleRateLimit(db, 'Cfixture', () => firstNow);
  assert.equal(await first.current(), null);

  await first.defer(90_000);

  const restarted = loaded.googleRateLimit(
    db,
    'Cfixture',
    () => new Date('2026-10-09T12:00:01.000Z'),
  );
  assert.equal(await restarted.current(), 89_000);
  await restarted.defer(30_000);
  assert.equal(await restarted.current(), 89_000, 'a shorter retry cannot reduce the saved pause');

  const otherCustomer = loaded.googleRateLimit(db, 'Canother', () => firstNow);
  assert.equal(await otherCustomer.current(), null);
});
