import assert from 'node:assert/strict';
import test from 'node:test';
import { pageLink, peopleQuery } from '../src/lib/people';
import { rosterReturn } from '../src/lib/roster-return';

void test('a broad search stays broad through profile, assignment and paginated roster returns', () => {
  for (const lookup of ['q=alex%40example.invalid', 'email=alex%40example.invalid']) {
    const returnTo = rosterReturn(
      `/people/?${lookup}&intent=search&status=member&committee=unassigned&zip=89104&cursor=next`,
    );
    assert.ok(returnTo);
    const profileReturn = new URL(returnTo, 'https://staff.lasvegasfortransit.org');
    assert.equal(peopleQuery(profileReturn).membershipStatus, undefined);
    assert.equal(peopleQuery(profileReturn).committeeId, 'unassigned');
    assert.equal(peopleQuery(profileReturn).zip, '89104');
    assert.equal(peopleQuery(profileReturn).cursor, 'next');

    const assignmentReturn = rosterReturn(returnTo);
    assert.equal(assignmentReturn, returnTo);
    const paginatedReturn = rosterReturn(pageLink(profileReturn, 'later'));
    assert.ok(paginatedReturn);
    const paginatedQuery = peopleQuery(
      new URL(paginatedReturn, 'https://staff.lasvegasfortransit.org'),
    );
    assert.equal(paginatedQuery.membershipStatus, undefined);
    assert.equal(paginatedQuery.cursor, 'later');
  }
});

void test('explicit membership filters stay filtered when returning to a search', () => {
  for (const status of ['member', 'former_member', 'not_member']) {
    const returnTo = rosterReturn(`/people/?q=Alex&intent=filters&status=${status}`);
    assert.ok(returnTo);
    assert.equal(
      peopleQuery(new URL(returnTo, 'https://staff.lasvegasfortransit.org')).membershipStatus,
      status,
    );
  }
});

void test('assignment returns to the same filtered roster without allowing arbitrary redirects', () => {
  assert.equal(
    rosterReturn('/people/?q=Alex&status=member&committee=unassigned&zip=89104&cursor=next'),
    '/people/?q=Alex&status=member&committee=unassigned&zip=89104&cursor=next',
  );
  assert.equal(
    rosterReturn('/people/?q=Alex&return_to=https://attacker.example#ignored'),
    '/people/?q=Alex',
  );
  for (const path of [
    null,
    '//attacker.example/people/',
    'https://attacker.example/people/',
    '/people/../access/',
    '/people/person-id/',
    '/people/\\attacker.example/',
  ]) {
    assert.equal(rosterReturn(path), null);
  }
});
