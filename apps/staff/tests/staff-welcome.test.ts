import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';

void test('the welcome screen appears only for a first staff session', async () => {
  const { PersonService } = await import('@lasvegasfortransit/platform-storage/person-service');
  const { createSsoSession } = await import('@lasvegasfortransit/platform-storage/staff-sso');
  const { createSession, endSession } = await import('@lasvegasfortransit/platform-storage/auth');
  const { ssoSessionFixture, ssoPrincipalFixture } = await import('./support/sso');
  const { hasEarlierStaffSession } = await import('../src/lib/onboarding');
  const db = memoryDb();
  const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-only' };
  const { person } = await new PersonService(db).upsertFromSource({
    source: 'join_form',
    fields: { email: 'member@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  // A member-site session is not a Staff Portal sign-in.
  await createSession(env, person.id, 'member');
  const principal = ssoPrincipalFixture('member@lasvegasfortransit.org', 'access-member');
  const first = await ssoSessionFixture(env, person.id, principal);
  assert.equal(await hasEarlierStaffSession(db, person.id), false);
  const second = await createSsoSession(env, principal);
  assert.ok(second);
  assert.equal(await hasEarlierStaffSession(db, person.id), true);
  // Signing out of one browser keeps the person's other staff sessions.
  await endSession(env, first.token);
  const third = await createSsoSession(env, principal);
  assert.ok(third);
  assert.equal(await hasEarlierStaffSession(db, person.id), true);
  db.raw.close();
});

void test('finishing account setup always asks for the welcome screen', async () => {
  const { staffWelcomePath } = await import('../src/lib/onboarding');
  assert.equal(staffWelcomePath('/paper/'), '/sign-in/ready/?next=%2Fpaper%2F');
  assert.equal(staffWelcomePath('/paper/', true), '/sign-in/ready/?next=%2Fpaper%2F&setup=1');
});
