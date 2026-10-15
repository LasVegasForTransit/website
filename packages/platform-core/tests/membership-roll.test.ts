import assert from 'node:assert/strict';
import test from 'node:test';
import { membershipStatus, MEMBERSHIP_RULES_V1 } from '../src/membership';

void test('a recognized current member needs no invented consent history', () => {
  assert.equal(membershipStatus([], undefined, { entitled: true, revokedAt: null }), 'member');
});
void test('the published first rule never treats a current roll as historical consent', () => {
  assert.equal(
    membershipStatus([], MEMBERSHIP_RULES_V1, { entitled: true, revokedAt: null }),
    'not_member',
  );
});
void test('an actual withdrawal takes precedence over an undated current-roll grant', () => {
  assert.equal(
    membershipStatus(
      [{ scope: 'newsletter', withdrawnAt: '2026-01-02T00:00:00.000Z' }],
      undefined,
      { entitled: true, revokedAt: null },
    ),
    'former_member',
  );
});
