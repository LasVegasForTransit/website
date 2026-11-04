import assert from 'node:assert/strict';
import test from 'node:test';
import type { AccessRow } from '@lasvegasfortransit/platform-storage/access-view';
import {
  profileProviders as providers,
  profileNeedsRecovery as needsRecovery,
  profileAccessLabel,
} from '../src/lib/profile-account-access';
import type { AccessConfiguration } from '@lasvegasfortransit/platform-core/access';
const configuration: AccessConfiguration = { discord: { configured: true, contextId: 'guild' } };
const profileProviders = (row: AccessRow, config = configuration) => providers(row, config);
const profileNeedsRecovery = (row: AccessRow) => needsRecovery(row, configuration);

const row: AccessRow = {
  personId: 'person',
  name: 'Member',
  email: null,
  membershipStatus: 'member',
  targetId: 'events',
  committeeName: 'Events Committee',
  assignmentId: 'assignment',
  role: 'member',
  expectedAccess: true,
  discordExpectedAccess: true,
  discordResourceId: 'role',
  discordFirstSeenAt: null,
  googleConnected: true,
  googleResourceId: null,
  discordConnected: true,
  operationId: 'operation',
  operationState: 'retry',
  lastFailure: 'unknown',
  googleWorkspace: { state: 'unknown', reason: 'not_mapped', observedAt: null },
  discord: { state: 'unknown', reason: 'not_mapped', observedAt: null },
};

void test('unmapped or disabled committee services do not offer a retry', () => {
  assert.deepEqual(profileProviders(row), []);
  assert.equal(profileNeedsRecovery(row), false);
  const disabled = { ...row, discord: { ...row.discord, reason: 'not_configured' as const } };
  assert.deepEqual(profileProviders(disabled), []);
  assert.equal(profileNeedsRecovery(disabled), false);
});

void test('unlinked accounts do not make an unmapped service appear on a committee', () => {
  assert.deepEqual(
    profileProviders({
      ...row,
      discordResourceId: null,
      googleResourceId: null,
      discord: { state: 'unknown', reason: 'not_linked', observedAt: null },
      googleWorkspace: { state: 'unknown', reason: 'not_linked', observedAt: null },
    }),
    [],
  );
});

void test('a configured provider failure remains recoverable without making stale success an error', () => {
  const failed = {
    ...row,
    discord: { state: 'unknown' as const, reason: 'permission_denied' as const, observedAt: null },
  };
  assert.equal(profileProviders(failed).length, 1);
  assert.equal(profileNeedsRecovery(failed), true);
  assert.equal(
    profileNeedsRecovery({
      ...row,
      discord: {
        state: 'unknown',
        reason: 'stale',
        observedAt: '2026-11-03T00:00:00.000Z',
        lastConfirmedState: 'granted',
      },
    }),
    false,
  );
});

void test('profile labels distinguish previous confirmation from a pending assignment update', () => {
  assert.equal(
    profileAccessLabel(
      {
        state: 'unknown',
        reason: 'stale',
        observedAt: '2026-11-03T00:00:00.000Z',
        lastConfirmedState: 'granted',
      },
      true,
    ),
    'Access last confirmed',
  );
  assert.equal(
    profileAccessLabel(
      { state: 'unknown', reason: 'stale', observedAt: '2026-11-03T00:00:00.000Z' },
      false,
    ),
    'Removal not confirmed yet',
  );
});

void test('expired failed removals remain recoverable', () => {
  assert.equal(
    profileNeedsRecovery({
      ...row,
      assignmentId: null,
      expectedAccess: false,
      lastFailure: 'permission_denied',
      discord: { state: 'unknown', reason: 'stale', observedAt: '2026-11-03T00:00:00.000Z' },
    }),
    true,
  );
});

void test('an expired confirmation of unwanted access keeps its removal retry', () => {
  assert.equal(
    profileNeedsRecovery({
      ...row,
      assignmentId: null,
      expectedAccess: false,
      discord: {
        state: 'unknown',
        reason: 'stale',
        observedAt: '2026-11-03T00:00:00.000Z',
        lastConfirmedState: 'granted',
      },
    }),
    true,
  );
});

void test('mapped but disabled services are omitted even when the account is unlinked', () => {
  assert.deepEqual(
    profileProviders(
      { ...row, discord: { state: 'unknown', reason: 'not_linked', observedAt: null } },
      {},
    ),
    [],
  );
});
