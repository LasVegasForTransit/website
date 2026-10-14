import assert from 'node:assert/strict';
import test from 'node:test';
import { observedAccess } from '../src/access-state';

void test('a stored Google confirmation outside the runtime group registry cannot prove access', () => {
  const now = new Date('2026-10-14T12:00:00.000Z');
  const resourceId = 'advocacy@lasvegasfortransit.org';
  const row = {
    personId: 'fixture-person',
    targetId: 'advocacy',
    generation: 1,
    expectedAccess: 1,
    googleIdentityCount: 1,
    googleIdentity: 'fixture-user',
    googleEmail: 'rider@lasvegasfortransit.org',
    discordIdentityCount: 0,
    discordIdentity: null,
    workspaceGroupEmail: resourceId,
    discordRoleId: null,
    discordObservation: null,
    googleObservation: JSON.stringify({
      identityId: 'fixture-user',
      identityEmail: 'rider@lasvegasfortransit.org',
      resourceId,
      contextId: 'Cfixture',
      generation: 1,
      expectedAccess: true,
      state: 'granted',
      observedAt: now.toISOString(),
      expiresAt: '2026-10-14T12:05:00.000Z',
    }),
  };
  const configuration = {
    google_workspace: {
      configured: true,
      contextId: 'Cfixture',
      resourceIds: ['preview-advocacy@lasvegasfortransit.org'],
    },
  };
  assert.equal(observedAccess(row, 'google_workspace', configuration, now).state, 'unknown');
  assert.equal(
    observedAccess(row, 'google_workspace', configuration, now).reason,
    'not_configured',
  );
  assert.equal(
    observedAccess(
      row,
      'google_workspace',
      { google_workspace: { ...configuration.google_workspace, resourceIds: [resourceId] } },
      now,
    ).state,
    'granted',
  );
});
