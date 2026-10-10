import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonService } from '../src/person-service';
import {
  createWorkspaceSession,
  linkWorkspaceIdentity,
  readWorkspaceSession,
  WorkspaceLinkService,
} from '../src/workspace-link';
import { memoryDb } from './support/db';
const workspace = {
  subject: 'member-subject',
  email: 'member@lasvegasfortransit.org',
  givenName: null,
  familyName: null,
};
const consent = {
  scope: 'newsletter' as const,
  source: 'join_form' as const,
  method: 'checkbox' as const,
  wordingVersion: 'join-form-v1',
};
async function fixture(member: boolean) {
  const db = memoryDb();
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'member@example.org' },
    ...(member ? { consent } : {}),
  });
  const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-only-secret' };
  return { db, people, person, env, service: new WorkspaceLinkService(env) };
}
void test('Workspace linking accepts only existing active members and never creates a person or consent', async () => {
  const { db, person, service } = await fixture(false);
  assert.notEqual(
    (
      await linkWorkspaceIdentity(db, {
        workspace,
        personId: person.id,
        method: 'self_linked',
        operationId: 'link',
      })
    ).kind,
    'ok',
  );
  const pending = await service.begin(workspace, { returnTo: '/account/' });
  assert.equal(
    (await service.requestCode(pending, { email: 'member@example.org', callerAddress: 'fixture' }))
      .kind,
    'no_person',
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM identities').get()?.n, 0);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 1);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 0);
  db.raw.close();
});
void test('withdrawal after requesting a linking code cannot grant Workspace access', async () => {
  const { db, person, service } = await fixture(true);
  const pending = await service.begin(workspace, { returnTo: '/account/' });
  const code = await service.requestCode(pending, {
    email: 'member@example.org',
    callerAddress: 'fixture',
  });
  assert.equal(code.kind, 'issued');
  db.raw.prepare("UPDATE people SET membership_status='former_member' WHERE id=?").run(person.id);
  assert.notEqual(
    (await service.complete(pending, { email: 'member@example.org', code: code.issued.code })).kind,
    'ok',
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM identities').get()?.n, 0);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM sessions').get()?.n, 0);
  db.raw.close();
});
void test('withdrawal invalidates existing Workspace sessions and refuses returning sign-in', async () => {
  const { db, person, env } = await fixture(true);
  assert.equal(
    (
      await linkWorkspaceIdentity(db, {
        workspace,
        personId: person.id,
        method: 'self_linked',
        operationId: 'link',
      })
    ).kind,
    'ok',
  );
  const session = await createWorkspaceSession(env, workspace);
  assert.ok(session);
  assert.ok(await readWorkspaceSession(env, session.token));
  db.raw.prepare("UPDATE people SET membership_status='former_member' WHERE id=?").run(person.id);
  assert.equal(await readWorkspaceSession(env, session.token), null);
  assert.equal(await createWorkspaceSession(env, workspace), null);
  db.raw.close();
});
