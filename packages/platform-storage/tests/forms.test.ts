import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonService } from '../src/person-service';
import { bootstrapStaffAdmin, loadActor } from '../src/staff-roles';
import { linkWorkspaceIdentity } from '../src/workspace-link';
import { memoryDb } from './support/db';
const now = new Date('2026-10-04T12:00:00Z');
async function fixture() {
  const loaded = await import('../src/form-tokens').catch(() => null);
  assert.ok(loaded, 'staff forms need actor/action-bound one-use tokens');
  const db = memoryDb();
  const { person } = await new PersonService(db).upsertFromSource({
    source: 'join_form',
    fields: { email: 'admin@example.org' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'join-form-v1',
    },
  });
  await linkWorkspaceIdentity(db, {
    workspace: {
      subject: 'google-admin',
      email: 'admin@lasvegasfortransit.org',
      givenName: null,
      familyName: null,
    },
    personId: person.id,
    method: 'self_linked',
    operationId: 'link',
  });
  await bootstrapStaffAdmin(db, {
    presidentPersonId: person.id,
    workspaceSubject: 'google-admin',
    performedBy: 'fixture-maintainer',
    operationId: 'bootstrap',
  });
  const actor = await loadActor(db, person.id);
  assert.ok(actor);
  return { ...loaded, db, actor };
}
void test('form tokens are bound to actor/action and consumed once under concurrent submissions', async () => {
  const { db, actor, issueFormToken, consumeFormToken } = await fixture();
  const token = await issueFormToken(db, actor, 'sign-out', now);
  assert.equal(
    await consumeFormToken(db, { ...actor, personId: 'other' }, { action: 'sign-out', token, now }),
    false,
  );
  assert.equal(
    await consumeFormToken(db, actor, { action: 'export', token: token, now: now }),
    false,
  );
  const results = await Promise.all([
    consumeFormToken(db, actor, { action: 'sign-out', token: token, now: now }),
    consumeFormToken(db, actor, { action: 'sign-out', token: token, now: now }),
  ]);
  assert.deepEqual(results.sort(), [false, true]);
  db.raw.close();
});
void test('expired tokens and stale roles cannot mutate with a previously issued token', async () => {
  const { db, actor, issueFormToken, consumeFormToken } = await fixture();
  const expired = await issueFormToken(db, actor, 'export', now);
  assert.equal(
    await consumeFormToken(db, actor, {
      action: 'export',
      token: expired,
      now: new Date(now.getTime() + 30 * 60_000),
    }),
    false,
  );
  const live = await issueFormToken(db, actor, 'export', now);
  db.raw
    .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
    .run(actor.personId);
  assert.equal(
    await consumeFormToken(db, actor, { action: 'export', token: live, now: now }),
    false,
  );
  db.raw.close();
});
