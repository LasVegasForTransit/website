import assert from 'node:assert/strict';
import test from 'node:test';
import { memberWelcomeEmail, welcomeAction } from '../platform/member-welcome';

void test('the campaign is the first step only while it is timely and not already the referral', () => {
  const during = new Date('2026-10-02T18:00:00Z');
  assert.match(welcomeAction([], null, during).href, /^https:\/\/lvwwd\.org\/take-part\//);
  assert.equal(welcomeAction([], 'wwd', during).href, 'https://lasvegasfortransit.org/go/');
  assert.equal(
    welcomeAction([], null, new Date('2026-10-09T07:00:00Z')).href,
    'https://lasvegasfortransit.org/go/',
  );
});

void test('evergreen first steps follow interests and always have a useful destination', () => {
  const later = new Date('2026-10-15T18:00:00Z');
  assert.equal(
    welcomeAction(['meetings'], null, later).href,
    'https://lasvegasfortransit.org/events/',
  );
  assert.equal(
    welcomeAction(['events'], null, later).href,
    'https://lasvegasfortransit.org/events/',
  );
  assert.equal(
    welcomeAction(['volunteering'], null, later).href,
    'https://lasvegasfortransit.org/join/#team',
  );
  assert.equal(welcomeAction(['news'], null, later).href, 'https://lasvegasfortransit.org/go/');
});

void test('welcome email escapes the name and keeps actions available with images blocked', () => {
  const email = memberWelcomeEmail({
    givenName: '<Alex>',
    action: welcomeAction(['events'], 'wwd', new Date('2026-10-02T18:00:00Z')),
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
