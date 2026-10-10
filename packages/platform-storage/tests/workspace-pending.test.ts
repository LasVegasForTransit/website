import assert from 'node:assert/strict';
import test from 'node:test';
import { requestCode, readSession } from '../src/auth';
import { PersonService } from '../src/person-service';
import { memoryDb } from './support/db';
const now = new Date('2026-10-04T12:00:00Z');
const workspace = {
  subject: 'google-subject',
  email: 'ana@lasvegasfortransit.org',
  givenName: 'Ana',
  familyName: 'Example',
};
async function fixture() {
  const loaded = await import('../src/workspace-link');
  assert.ok(
    'WorkspaceLinkService' in loaded,
    'Workspace linking needs a browser-bound personal-email confirmation',
  );
  const db = memoryDb();
  const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-only-secret' };
  const service = new loaded.WorkspaceLinkService(env);
  return { db, env, service };
}
void test('personal sign-in codes cannot link Workspace; a bound confirmation links once and starts a twelve-hour session', async () => {
  const { db, env, service } = await fixture();
  const { person } = await new PersonService(db).upsertFromSource({
    source: 'join_form',
    fields: { email: 'personal@example.org' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'join-form-v1',
    },
  });
  const pending = await service.begin(workspace, { returnTo: '/account/', now });
  const signIn = await requestCode(env, {
    email: 'personal@example.org',
    purpose: 'sign_in',
    callerAddress: 'fixture',
    now,
  });
  assert.equal(signIn.kind, 'issued');
  assert.equal(
    (
      await service.complete(pending, {
        email: 'personal@example.org',
        code: signIn.issued.code,
        now,
      })
    ).kind,
    'expired',
  );
  const code = await service.requestCode(pending, {
    email: ' Personal@Example.org ',
    callerAddress: 'fixture',
    now,
  });
  assert.equal(code.kind, 'issued');
  const results = await Promise.all([
    service.complete(pending, { email: 'personal@example.org', code: code.issued.code, now }),
    service.complete(pending, { email: 'personal@example.org', code: code.issued.code, now }),
  ]);
  assert.equal(results.filter((r) => r.kind === 'ok').length, 1);
  const success = results.find((r) => r.kind === 'ok');
  assert.equal(success?.personId, person.id);
  assert.ok(success);
  const session = await readSession(env, success.session.token, now);
  assert.equal(session?.type, 'staff');
  assert.equal(session.expiresAt.toISOString(), '2026-10-05T00:00:00.000Z');
  assert.equal(
    db.raw.prepare('SELECT link_method FROM identities').get()?.link_method,
    'self_linked',
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 1);
  db.raw.close();
});
void test('a linking code is bound to its pending Google account', async () => {
  const { db, service } = await fixture();
  await new PersonService(db).upsertFromSource({
    source: 'join_form',
    fields: { email: 'personal@example.org' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'join-form-v1',
    },
  });
  const first = await service.begin(workspace, { returnTo: '/account/', now });
  const second = await service.begin(
    { ...workspace, subject: 'other-google' },
    { returnTo: '/account/', now },
  );
  const code = await service.requestCode(first, {
    email: 'personal@example.org',
    callerAddress: 'fixture',
    now,
  });
  assert.equal(code.kind, 'issued');
  assert.equal(
    (await service.complete(second, { email: 'personal@example.org', code: code.issued.code, now }))
      .kind,
    'expired',
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM identities').get()?.n, 0);
  db.raw.close();
});
void test('returning Workspace sessions bind the stable Google subject and do not verify a different personal email', async () => {
  const { db, env } = await fixture();
  const { createWorkspaceSession, readWorkspaceSession, linkWorkspaceIdentity } =
    await import('../src/workspace-link');
  const { person } = await new PersonService(db).upsertFromSource({
    source: 'join_form',
    fields: { email: 'personal@example.org' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'join-form-v1',
    },
  });
  await linkWorkspaceIdentity(db, {
    workspace,
    personId: person.id,
    method: 'self_linked',
    operationId: 'fixture',
  });
  const session = await createWorkspaceSession(env, workspace, now);
  assert.ok(session);
  assert.equal(
    (await readWorkspaceSession(env, session.token, now))?.workspaceSubject,
    workspace.subject,
  );
  assert.equal(
    db.raw.prepare('SELECT email_verified_at FROM people').get()?.email_verified_at,
    null,
  );
  db.raw.prepare("DELETE FROM identities WHERE platform='google_workspace'").run();
  assert.equal(await readWorkspaceSession(env, session.token, now), null);
  db.raw.close();
});
