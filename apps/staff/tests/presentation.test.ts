import assert from 'node:assert/strict';
import test from 'node:test';
import { displayLabel } from '../src/lib/presentation';

void test('access history explains known reasons and never exposes unknown internal codes', () => {
  for (const [reason, label] of [
    ['access_review_assignment', 'Added during staff access review'],
    ['moved', 'Moved away'],
    ['left_lvbt', 'Left LVBT'],
    ['removed', 'Removed by LVBT'],
    ['membership_change', 'Membership changed'],
    ['person_deleted', 'Account deleted'],
  ] as const) {
    assert.equal(displayLabel(reason), label);
  }
  for (const reason of ['provider_secret_operation', '<b>Internal state</b>']) {
    assert.equal(displayLabel(reason), 'Other change');
  }
  assert.equal(displayLabel(''), 'Details not recorded');
  assert.equal(displayLabel('  '), 'Details not recorded');
});
