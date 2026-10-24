import assert from 'node:assert/strict';
import test from 'node:test';
import { hashWithSecret } from '@lasvegasfortransit/platform-core/signing';
import { collectPersonExport } from '../src/person-export';
import { createSsoSession, revokeSsoPrincipal } from '../src/staff-sso';
import { mergeFixture } from './support/merge-fixture';

async function fixture() {
  const f = await mergeFixture();
  const env = { PLATFORM_DB: f.db, LVBT_SIGN_IN_SECRET: 'export-sso-fixture' };
  const principal = {
    issuer: 'https://team.cloudflareaccess.com',
    subject: 'export-admin',
    email: 'admin@lasvegasfortransit.org',
    expiresAt: new Date(Date.now() + 60_000),
  };
  f.db.raw
    .prepare(
      'INSERT INTO staff_sso_links(id,person_id,issuer,subject,email,created_at) VALUES(?,?,?,?,?,?)',
    )
    .run(
      'export-sso',
      f.admin.id,
      principal.issuer,
      principal.subject,
      principal.email,
      new Date().toISOString(),
    );
  f.db.raw
    .prepare("DELETE FROM identities WHERE person_id=? AND platform='google_workspace'")
    .run(f.admin.id);
  f.db.raw
    .prepare(
      'INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES(?,?,?)',
    )
    .run(f.survivor.id, f.admin.id, new Date().toISOString());
  const session = await createSsoSession(env, principal);
  assert.ok(session);
  const authority = {
    kind: 'administrator' as const,
    personId: f.admin.id,
    sessionHash: await hashWithSecret(env.LVBT_SIGN_IN_SECRET, `session:${session.token}`),
    sso: { issuer: principal.issuer, subject: principal.subject },
  };
  return { ...f, principal, authority };
}
void test('an SSO-only administrator exports a selected member with independent provider authority', async (t) => {
  const f = await fixture();
  t.after(() => f.db.raw.close());
  const exported = await collectPersonExport(f.db, f.survivor.id, f.authority);
  assert.ok(exported);
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM staff_audits WHERE action='person.export'").get()
      ?.n,
    1,
  );
});
for (const change of ['issuer', 'subject', 'mode', 'role', 'membership', 'revoked'] as const)
  void test(`SSO export refuses ${change} without an export audit`, async (t) => {
    const f = await fixture();
    t.after(() => f.db.raw.close());
    if (change === 'issuer') f.authority.sso.issuer = 'https://other.example';
    if (change === 'subject') f.authority.sso.subject = 'other-subject';
    if (change === 'mode')
      f.db.raw
        .prepare("UPDATE sessions SET authentication_source='google' WHERE id_hash=?")
        .run(f.authority.sessionHash);
    if (change === 'role')
      f.db.raw.prepare('DELETE FROM staff_administrators WHERE person_id=?').run(f.admin.id);
    if (change === 'membership')
      f.db.raw
        .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
        .run(f.admin.id);
    if (change === 'revoked') await revokeSsoPrincipal(f.db, f.principal);
    assert.equal(await collectPersonExport(f.db, f.survivor.id, f.authority), null);
    assert.equal(
      f.db.raw.prepare("SELECT count(*) AS n FROM staff_audits WHERE action='person.export'").get()
        ?.n,
      0,
    );
  });
