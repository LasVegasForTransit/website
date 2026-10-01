import assert from 'node:assert/strict';
import test from 'node:test';
import {
  featuredWelcomeAction,
  memberWelcomeEmail,
  welcomeAction,
} from '../platform/member-welcome';
import { memoryDb } from './support/platform-db';

void test('configured campaigns are timely and skip their own referrals', async () => {
  const db = memoryDb();
  const during = new Date('2026-10-02T18:00:00Z');
  assert.match(
    (await featuredWelcomeAction(db, null, during))?.href ?? '',
    /^https:\/\/lvwwd\.org\/take-part\//,
  );
  assert.equal(await featuredWelcomeAction(db, 'wwd', during), null);
  assert.ok(await featuredWelcomeAction(db, 'partner_name', during));
  assert.equal(await featuredWelcomeAction(db, null, new Date('2026-10-09T07:00:00Z')), null);
});

void test('evergreen first steps follow interests and always have a useful destination', () => {
  assert.equal(welcomeAction(['meetings'], null).href, 'https://lasvegasfortransit.org/events/');
  assert.equal(welcomeAction(['events'], null).href, 'https://lasvegasfortransit.org/events/');
  assert.equal(
    welcomeAction(['volunteering'], null).href,
    'https://lasvegasfortransit.org/join/#team',
  );
  assert.equal(welcomeAction(['news'], null).href, 'https://lasvegasfortransit.org/go/');
});

void test('welcome email escapes the name and keeps actions available with images blocked', () => {
  const email = memberWelcomeEmail({
    givenName: '<Alex>',
    action: welcomeAction(['events'], null),
    unsubscribeUrl: 'https://lasvegasfortransit.org/join/remove/?token=signed',
  });
  assert.match(email.html, /Welcome to LVBT, &lt;Alex&gt;!/);
  assert.doesNotMatch(email.html, /Welcome to LVBT, <Alex>!/);
  assert.match(email.html, /https:\/\/lasvegasfortransit\.org\/email\/discord-icon\.png/);
  assert.match(email.html, /Join the server/);
  assert.match(email.html, /Unsubscribe from LVBT/);
  assert.match(email.text, /Join the server|Discord:/);
  assert.match(email.text, /join\/remove\/\?token=signed/);
});
