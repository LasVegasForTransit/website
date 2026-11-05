import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { workspaceDb } from './support/workspace-db';
import { workspaceConnectorRequest } from '../src/workspace-connector-api';
const now = new Date('2026-11-04T20:00:00Z');
const audience = 'https://preview.lasvegasfortransit.org/api/workspace/v1';
const subject = '111111111111111111111';
async function fixture() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'scan-fixture', alg: 'RS256', use: 'sig' };
  const fetcher: typeof fetch = (input) => {
    assert.equal(
      input instanceof Request ? input.url : input.toString(),
      'https://www.googleapis.com/oauth2/v3/certs',
    );
    return Promise.resolve(Response.json({ keys: [jwk] }));
  };
  const policy = {
    environment: 'preview',
    customerId: 'C-lvbt',
    humanOrgUnitIds: [],
    includedUserIds: [],
    excludedUserIds: [],
    previewUserIds: [],
    consoleGroupEmail: 'console-preview@lasvegasfortransit.org',
    productionConsoleGroupEmail: 'console-users@lasvegasfortransit.org',
    managedGroups: ['committee-preview@lasvegasfortransit.org'],
    productionGroups: ['committee@lasvegasfortransit.org'],
  };
  const env = {
    PLATFORM_DB: workspaceDb(memoryDb()),
    LVBT_WORKSPACE_ONBOARDING_ENABLED: 'true',
    LVBT_WORKSPACE_CONNECTOR_SUBJECT: subject,
    LVBT_WORKSPACE_CONNECTOR_AUDIENCE: audience,
    LVBT_WORKSPACE_ONBOARDING_CONFIG: JSON.stringify(policy),
  };
  return { env, fetcher, privateKey };
}
async function send(
  f: Awaited<ReturnType<typeof fixture>>,
  action: string,
  input: Record<string, unknown> = {},
  at = now,
) {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'scan-fixture' })
    .setIssuer('https://accounts.google.com')
    .setSubject(subject)
    .setAudience(audience)
    .setIssuedAt(at)
    .setExpirationTime(new Date(at.getTime() + 3600000))
    .sign(f.privateKey);
  return workspaceConnectorRequest(
    f.env,
    new Request(audience, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...input }),
    }),
    { fetch: f.fetcher, now: () => at },
  );
}
function object(value: unknown) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
void test('after four days a leased active or deleted scan can restart an expired provider cursor', async () => {
  for (const phase of ['active', 'deleted']) {
    const f = await fixture();
    const first = object(await (await send(f, 'scanClaim')).json());
    await send(f, 'scanSave', {
      token: first.token,
      phase,
      pageToken: 'expired-provider-cursor',
      offset: 20,
      complete: false,
    });
    const later = new Date(now.getTime() + 4 * 86400000);
    const current = object(await (await send(f, 'scanClaim', {}, later)).json());
    assert.equal((await send(f, 'scanReset', { token: first.token }, later)).status, 409);
    assert.equal((await send(f, 'scanReset', { token: current.token }, later)).status, 200);
    const restarted = object(await (await send(f, 'scanClaim', {}, later)).json());
    assert.equal(restarted.phase, 'active');
    assert.equal(restarted.pageToken, null);
    assert.equal(restarted.offset, 0);
    assert.equal((await send(f, 'scanReset', { token: current.token }, later)).status, 409);
  }
});
void test('an expired scan lease cannot reset a cursor owned by another invocation', async () => {
  const f = await fixture();
  const first = object(await (await send(f, 'scanClaim')).json());
  const later = new Date(now.getTime() + 61000);
  const current = object(await (await send(f, 'scanClaim', {}, later)).json());
  assert.equal((await send(f, 'scanReset', { token: first.token }, later)).status, 409);
  assert.equal((await send(f, 'scanReset', { token: current.token }, later)).status, 200);
});
