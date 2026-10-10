import assert from 'node:assert/strict';
import test from 'node:test';
import { peopleQuery } from '../src/lib/people';
void test('people filters accept only actual membership statuses and reject invalid ZIP codes', () => {
  assert.equal(
    peopleQuery(new URL('https://staff.lasvegasfortransit.org/people/')).membershipStatus,
    'member',
  );
  assert.equal(
    peopleQuery(new URL('https://staff.lasvegasfortransit.org/people/?status=all'))
      .membershipStatus,
    undefined,
  );
  assert.throws(() =>
    peopleQuery(new URL('https://staff.lasvegasfortransit.org/people/?status=constructor')),
  );
  assert.throws(() =>
    peopleQuery(new URL('https://staff.lasvegasfortransit.org/people/?zip=8910')),
  );
});
void test('a name or email lookup includes former members unless membership was explicitly filtered', () => {
  const query = (params: string) =>
    peopleQuery(new URL(`https://staff.lasvegasfortransit.org/people/${params}`));
  assert.equal(query('?q=Known%20Person').membershipStatus, undefined);
  assert.equal(query('?email=known%40example.invalid').membershipStatus, undefined);
  assert.equal(query('?q=%20').membershipStatus, 'member');
  assert.equal(query('?q=Known&status=member').membershipStatus, 'member');
  assert.equal(query('?q=Known&status=former_member').membershipStatus, 'former_member');
});
