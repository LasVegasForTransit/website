import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonService } from '../src/person-service';
import { memoryDb } from './support/db';

async function service() {
  const loaded = await import('../src/workspace-link').catch(() => null);
  assert.ok(loaded, 'Workspace linking must preserve a unique verified identity');
  return loaded;
}
const now = new Date('2026-10-04T12:00:00Z');
const workspace = {
  subject: 'google-subject',
  email: 'volunteer@lasvegasfortransit.org',
  givenName: 'Ana',
  familyName: 'Example',
};

void test('OAuth state is consumed once and expires after ten minutes', async () => {
  const { beginWorkspaceSignIn, consumeWorkspaceState } = await service();
  const db = memoryDb();
  const started = await beginWorkspaceSignIn(db, {
    returnTo: '/account',
    callbackUrl: 'https://lasvegasfortransit.org/sign-in/google/callback',
    now,
  });
  assert.ok(started.state.length >= 43);
  assert.notEqual(started.verifier, started.challenge);
  const consumed = await consumeWorkspaceState(db, started.state, now);
  assert.equal(consumed?.returnTo, '/account');
  assert.equal(consumed.verifier, started.verifier);
  assert.equal(await consumeWorkspaceState(db, started.state, now), null);
  const expired = await beginWorkspaceSignIn(db, {
    returnTo: '/account',
    callbackUrl: 'https://lasvegasfortransit.org/sign-in/google/callback',
    now,
  });
  assert.equal(
    await consumeWorkspaceState(db, expired.state, new Date('2026-10-04T12:10:00Z')),
    null,
  );
  db.raw.close();
});

void test('OAuth state refuses arbitrary callback hosts and external return destinations', async () => {
  const { beginWorkspaceSignIn } = await service();
  const db = memoryDb();
  for (const [returnTo, callbackUrl] of [
    ['//attacker.example', 'https://lasvegasfortransit.org/sign-in/google/callback'],
    ['/account', 'https://attacker.example/sign-in/google/callback'],
    ['/account', 'https://lasvegasfortransit.org.attacker.example/sign-in/google/callback'],
  ] as const) {
    await assert.rejects(beginWorkspaceSignIn(db, { returnTo, callbackUrl, now }));
  }
  db.raw.close();
});

void test('two people cannot claim the same Workspace identity and a retry keeps the original person', async () => {
  const { linkWorkspaceIdentity } = await service();
  const db = memoryDb();
  const people = new PersonService(db);
  const first = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'ana@example.org' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'join-form-v1',
    },
  });
  const second = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'bo@example.org' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'join-form-v1',
    },
  });
  const results = await Promise.all(
    [first.person, second.person].map((person) =>
      linkWorkspaceIdentity(db, {
        workspace,
        personId: person.id,
        method: 'self_linked',
        operationId: person.id,
      }),
    ),
  );
  assert.deepEqual(results.map((result) => result.kind).sort(), ['conflict', 'ok']);
  const identity = db.raw
    .prepare("SELECT person_id FROM identities WHERE platform = 'google_workspace'")
    .get();
  assert.ok(identity && typeof identity.person_id === 'string');
  assert.equal(
    (
      await linkWorkspaceIdentity(db, {
        workspace,
        personId: identity.person_id,
        method: 'self_linked',
        operationId: 'retry',
      })
    ).kind,
    'ok',
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS count FROM identities').get()?.count, 1);
  assert.equal((await people.getPerson(identity.person_id))?.membership_status, 'member');
  db.raw.close();
});
