import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { workspaceConnectorRequest } from '../../src/workspace-connector-api';
import type { WorkspaceGroupClaim } from '@lasvegasfortransit/platform-core/workspace-connector';
import { workspaceDb } from './workspace-db';

export const now = new Date('2026-11-04T20:00:00Z');
export const audience = 'https://preview.lasvegasfortransit.org/api/workspace/v1';
export const subject = '111111111111111111111';
export const directoryUser = {
  customerId: 'C-lvbt',
  userId: 'google-test',
  email: 'test@lasvegasfortransit.org',
  givenName: 'Test',
  familyName: 'Volunteer',
  orgUnitId: 'ou-people',
  suspended: false,
  archived: false,
  deleted: false,
  observedAt: now.toISOString(),
};
export async function fixture() {
  const keys = await generateKeyPair('RS256');
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: 'workspace-fixture',
    alg: 'RS256',
    use: 'sig',
  };
  const fetcher: typeof fetch = (input) => {
    assert.equal(
      input instanceof Request ? input.url : input.toString(),
      'https://www.googleapis.com/oauth2/v3/certs',
    );
    return Promise.resolve(Response.json({ keys: [jwk] }));
  };
  const db = memoryDb();
  const env = {
    PLATFORM_DB: workspaceDb(db),
    LVBT_WORKSPACE_ONBOARDING_ENABLED: 'true',
    LVBT_WORKSPACE_CONNECTOR_SUBJECT: subject,
    LVBT_WORKSPACE_CONNECTOR_AUDIENCE: audience,
    LVBT_WORKSPACE_ONBOARDING_CONFIG: JSON.stringify({
      environment: 'preview',
      customerId: 'C-lvbt',
      humanOrgUnitIds: ['ou-people'],
      includedUserIds: [],
      excludedUserIds: [],
      previewUserIds: ['google-test'],
      consoleGroupEmail: 'console-preview@lasvegasfortransit.org',
      productionConsoleGroupEmail: 'console-users@lasvegasfortransit.org',
      managedGroups: ['committee-preview@lasvegasfortransit.org'],
      productionGroups: ['committee@lasvegasfortransit.org'],
    }),
  };
  async function token(overrides: { subject?: string; audience?: string; issuer?: string } = {}) {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'workspace-fixture' })
      .setIssuer(overrides.issuer ?? 'https://accounts.google.com')
      .setSubject(overrides.subject ?? subject)
      .setAudience(overrides.audience ?? audience)
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(now.getTime() / 1000) + 600)
      .sign(keys.privateKey);
  }
  return { db, env, fetcher, token };
}
export async function send(
  f: Awaited<ReturnType<typeof fixture>>,
  action: string,
  input: Record<string, unknown> = {},
  at = now,
) {
  return workspaceConnectorRequest(
    f.env,
    new Request(audience, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await f.token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...input }),
    }),
    { fetch: f.fetcher, now: () => at },
  );
}
export async function consoleClaim(f: Awaited<ReturnType<typeof fixture>>) {
  await send(f, 'enroll', { account: directoryUser });
  const response = await send(f, 'claim');
  assert.equal(response.status, 200);
  const claim = await replyJson(response);
  assert.equal(claim.plan.kind, 'console');
  return claim;
}
export function observation(claim: WorkspaceGroupClaim, granted = true) {
  const group = claim.plan.groups[0];
  assert.ok(group);
  return {
    groupEmail: group.resourceId,
    groupId: 'group-console',
    identityId: claim.plan.userId,
    identityEmail: claim.plan.email,
    direct: granted,
    granted,
    role: granted ? 'MEMBER' : null,
  };
}

interface ProtocolReply extends WorkspaceGroupClaim {
  kind: string;
  results: { kind: string }[];
  registered: boolean;
  valid: boolean;
  phase: string;
  pageToken: string | null;
  offset: number;
}
export async function replyJson(response: Response): Promise<ProtocolReply> {
  const value: unknown = JSON.parse(await response.text());
  return value as ProtocolReply;
}
