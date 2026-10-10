import assert from 'node:assert/strict';
import test from 'node:test';
import { rosterReturn } from '../src/lib/roster-return';

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
