import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { WorkspaceLinkService } from '@lasvegasfortransit/platform-storage/workspace-link';
import { PENDING_COOKIE } from '@lasvegasfortransit/platform-integrations/google-sign-in';
import { workspaceLinkPage } from '../src/lib/workspace-link-page';
void test('staff account creation rejects a missing name and ignores spoofed person IDs', async () => {
  const db = memoryDb();
  const env = {
    PLATFORM_DB: db,
    LVBT_STAFF_AUTH_MODE: 'google',
    LVBT_SIGN_IN_SECRET: 'fixture-only-secret',
  };
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
    headers: {
      Origin: 'https://staff.lasvegasfortransit.org',
      Cookie: `${PENDING_COOKIE}=${pending}`,
    },
    body: new URLSearchParams({ action: 'create', actorId: 'spoofed' }),
  });
  const result = await workspaceLinkPage(env, request, () => {
    assert.fail('removed action must send no email');
  });
  assert.ok(!(result instanceof Response));
  assert.equal(result.status, 400);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 0);
  db.raw.close();
});
void test('expired membership confirmation explains recovery and clears both stale cookies', async () => {
  const db = memoryDb();
  try {
    const env = {
      PLATFORM_DB: db,
      LVBT_STAFF_AUTH_MODE: 'google',
      LVBT_SIGN_IN_SECRET: 'fixture-only-secret',
    };
    const pending = await new WorkspaceLinkService(env).begin(
      {
        subject: 'fixture-google',
        email: 'member@lasvegasfortransit.org',
        givenName: null,
        familyName: null,
      },
      { returnTo: '/people/', now: new Date('2020-01-01T00:00:00.000Z') },
    );
    const result = await workspaceLinkPage(
      env,
      new Request('https://staff.lasvegasfortransit.org/sign-in/link-account/', {
        headers: {
          Origin: 'https://staff.lasvegasfortransit.org',
          Cookie: `${PENDING_COOKIE}=${pending}`,
        },
      }),
      () => assert.fail('an expired flow must not send email'),
    );
    assert.ok(result instanceof Response);
    assert.equal(result.headers.get('Location'), '/sign-in/?membership_confirmation_expired=1');
    const cookies = result.headers.get('Set-Cookie') ?? '';
    assert.match(cookies, /__Host-lvbt_workspace_pending=; Max-Age=0/);
    assert.match(cookies, /__Host-lvbt_workspace_email=; Max-Age=0/);
  } finally {
    db.raw.close();
  }
});

void test('a wrong six-digit code explains retry without suggesting the field is empty', async () => {
  const { PersonService } = await import('@lasvegasfortransit/platform-storage/person-service');
  const { signToken } = await import('@lasvegasfortransit/platform-core/signing');
  const { digestToken } = await import('@lasvegasfortransit/platform-core/random-token');
  const db = memoryDb();
  const env = {
    PLATFORM_DB: db,
    LVBT_STAFF_AUTH_MODE: 'google',
    LVBT_SIGN_IN_SECRET: 'fixture-only',
  };
  await new PersonService(db).upsertFromSource({
    source: 'join_form',
    fields: { email: 'member@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  const service = new WorkspaceLinkService(env);
  const pending = await service.begin(
    {
      subject: 'fixture-google',
      email: 'member@lasvegasfortransit.org',
      givenName: null,
      familyName: null,
    },
    { returnTo: '/paper/' },
  );
  const issued = await service.requestCode(pending, {
    email: 'member@example.invalid',
    callerAddress: 'fixture',
  });
  assert.equal(issued.kind, 'issued');
  const step = await signToken(env.LVBT_SIGN_IN_SECRET, {
    purpose: 'workspace_email_step',
    subject: await digestToken(pending),
    expiresAt: Date.now() + 900000,
    data: { email: 'member@example.invalid' },
  });
  const result = await workspaceLinkPage(
    env,
    new Request('https://staff.lasvegasfortransit.org/sign-in/link-account/', {
      method: 'POST',
      headers: {
        Origin: 'https://staff.lasvegasfortransit.org',
        Cookie: `${PENDING_COOKIE}=${pending}; __Host-lvbt_workspace_email=${step}`,
      },
      body: new URLSearchParams({
        action: 'confirm',
        code: issued.issued.code === '000000' ? '111111' : '000000',
      }),
    }),
    () => assert.fail('wrong code must send no email'),
  );
  assert.ok(!(result instanceof Response));
  assert.equal(result.status, 400);
  assert.match(result.notice ?? '', /That code didn’t match/);
  db.raw.close();
});
