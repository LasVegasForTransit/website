import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { resolveStaffContext } from '../src/lib/context';

void test('background resources cannot restart an unfinished sign-in', async () => {
  const db = memoryDb();
  try {
    for (const mode of ['cloudflare-access', 'google'] as const) {
      const env = {
        PLATFORM_DB: db,
        LVBT_SIGN_IN_SECRET: 'background-fixture-only',
        LVBT_STAFF_AUTH_MODE: mode,
      };
      for (const destination of [
        'image',
        'style',
        'font',
        'script',
        'empty',
        'document',
        'iframe',
      ]) {
        const result = await resolveStaffContext(
          new Request('https://staff.lasvegasfortransit.org/favicon.ico', {
            headers: { 'Sec-Fetch-Dest': destination },
          }),
          env,
        );
        assert.ok(result instanceof Response);
        const navigation = ['document', 'iframe'].includes(destination);
        assert.equal(result.status, navigation ? 303 : 401);
        assert.equal(Boolean(result.headers.get('Location')), navigation);
        assert.equal(result.headers.get('Set-Cookie'), null);
      }
    }
  } finally {
    db.raw.close();
  }
});
