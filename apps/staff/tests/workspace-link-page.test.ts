import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { WorkspaceLinkService } from '@lasvegasfortransit/platform-storage/workspace-link';
import { PENDING_COOKIE } from '@lasvegasfortransit/platform-integrations/google-sign-in';
import { workspaceLinkPage } from '../src/lib/workspace-link-page';
void test('staff linking rejects the removed creation action and never creates a person', async () => {
  const db = memoryDb();
  const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-only-secret' };
  const pending = await new WorkspaceLinkService(env).begin(
    {
      subject: 'fixture-google',
      email: 'member@lasvegasfortransit.org',
      givenName: null,
      familyName: null,
    },
    { returnTo: '/people/' },
  );
  const request = new Request('https://staff.lasvegasfortransit.org/sign-in/link-account/', {
    method: 'POST',
    headers: { Cookie: `${PENDING_COOKIE}=${pending}` },
    body: new URLSearchParams({ action: 'create', actorId: 'spoofed' }),
  });
  const result = await workspaceLinkPage(env, request, () => {
    assert.fail('removed action must send no email');
  });
  assert.ok(result instanceof Response);
  assert.equal(result.status, 400);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 0);
  db.raw.close();
});
