import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonService } from '../src/person-service';
import { bootstrapStaffAdmin, loadActor } from '../src/staff-roles';
import { linkWorkspaceIdentity } from '../src/workspace-link';
import { CommitteeService } from '../src/committees';
import { WelcomeService } from '../src/welcome';
import { welcomeCommittees } from '../src/welcome-committees';
import { memoryDb } from './support/db';
async function fixture() {
  const db = memoryDb();
  const people = new PersonService(db);
  const member = async (name: string) => {
    const { person } = await people.upsertFromSource({
      source: 'join_form',
      fields: { given_name: name, email: `${name}@example.invalid` },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    });
    await people.recordEngagement(person.id, {
      type: 'joined',
      occurredAt: new Date().toISOString(),
      source: 'join_form',
      details: { interests: ['events'] },
    });
    return person;
  };
  const admin = await member('admin');
  await linkWorkspaceIdentity(db, {
    workspace: {
      subject: 'admin',
      email: 'admin@lasvegasfortransit.org',
      givenName: null,
      familyName: null,
    },
    personId: admin.id,
    method: 'self_linked',
    operationId: 'link',
  });
  await bootstrapStaffAdmin(db, {
    presidentPersonId: admin.id,
    workspaceSubject: 'admin',
    performedBy: 'fixture',
    operationId: 'bootstrap',
  });
  const lead = await member('lead');
  const service = new CommitteeService(db);
  const assignment = await service.assign({
    personId: lead.id,
    committeeId: 'events',
    role: 'lead',
    actorId: admin.id,
    operationId: 'lead',
  });
  assert.equal(assignment.kind, 'ok');
  const actor = await loadActor(db, lead.id);
  assert.ok(actor);
  db.raw.prepare("UPDATE committees SET interest_ids='[\"events\"]' WHERE id='events'").run();
  const person = await member('new');
  return { db, people, admin, lead, actor, person, service, welcome: new WelcomeService(db) };
}
void test('welcome handoff requires the current claimant and queues one real committee assignment', async () => {
  const f = await fixture();
  const input = {
    personId: f.person.id,
    committeeId: 'events',
    role: 'member' as const,
    actorId: f.lead.id,
    operationId: 'handoff',
    fromWelcome: true as const,
  };
  assert.deepEqual(await welcomeCommittees(f.db, f.actor, f.person.id), []);
  assert.equal((await f.service.assign(input)).kind, 'conflict');
  assert.equal((await f.welcome.claim(f.actor, f.person.id, { operationId: 'claim' })).kind, 'ok');
  assert.deepEqual(
    (await welcomeCommittees(f.db, f.actor, f.person.id)).map((row) => row.id),
    ['events'],
  );
  assert.deepEqual((await f.welcome.contact(f.actor, f.person.id))?.interests, ['events']);
  const result = await f.service.assign(input);
  assert.equal(result.kind, 'ok');
  assert.deepEqual(await f.service.assign(input), result);
  assert.equal((await welcomeCommittees(f.db, f.actor, f.person.id))[0]?.assigned, true);
  assert.equal(
    f.db.raw.prepare('SELECT count(*) AS n FROM integration_outbox WHERE id=?').get('handoff')?.n,
    1,
  );
  assert.equal(
    f.db.raw
      .prepare(
        'SELECT count(*) AS n FROM committee_assignments WHERE person_id=? AND ended_at IS NULL',
      )
      .get(f.person.id)?.n,
    1,
  );
  assert.equal(
    f.db.raw
      .prepare("SELECT count(*) AS n FROM engagement_events WHERE person_id=? AND type='welcomed'")
      .get(f.person.id)?.n,
    0,
  );
  assert.ok(await f.welcome.contact(f.actor, f.person.id));
  f.db.raw.close();
});
void test('a welcome claim cannot assign another team or outlive its authority, expiry or membership', async () => {
  const f = await fixture();
  await f.welcome.claim(f.actor, f.person.id, { operationId: 'claim' });
  const input = {
    personId: f.person.id,
    committeeId: 'events',
    role: 'member' as const,
    actorId: f.lead.id,
    operationId: 'handoff',
    fromWelcome: true as const,
  };
  assert.equal((await f.service.assign({ ...input, committeeId: 'advocacy' })).kind, 'forbidden');
  f.db.raw.prepare("UPDATE committees SET interest_ids='[]' WHERE id='events'").run();
  assert.deepEqual(await welcomeCommittees(f.db, f.actor, f.person.id), []);
  assert.equal((await f.service.assign(input)).kind, 'conflict');
  f.db.raw.prepare("UPDATE committees SET interest_ids='[\"events\"]' WHERE id='events'").run();
  f.db.raw.prepare("UPDATE welcome_claims SET expires_at='2000-01-01T00:00:00.000Z'").run();
  assert.equal((await f.service.assign(input)).kind, 'conflict');
  f.db.raw.prepare("UPDATE welcome_claims SET expires_at='2099-01-01T00:00:00.000Z'").run();
  await f.people.withdrawConsent(f.person.id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: new Date().toISOString(),
  });
  assert.equal((await f.service.assign(input)).kind, 'conflict');
  assert.equal(
    (
      await f.service.assign({
        personId: f.person.id,
        committeeId: 'events',
        role: 'member',
        actorId: f.admin.id,
        operationId: 'former',
      })
    ).kind,
    'conflict',
  );
  assert.equal(
    f.db.raw
      .prepare('SELECT count(*) AS n FROM committee_assignments WHERE person_id=?')
      .get(f.person.id)?.n,
    0,
  );
  f.db.raw.close();
});
void test('claim expiry during a handoff transaction prevents the assignment and its queued work', async () => {
  const f = await fixture();
  await f.welcome.claim(f.actor, f.person.id, { operationId: 'claim' });
  const guarded = new CommitteeService({
    prepare: (sql) => f.db.prepare(sql),
    batch: async (statements) => {
      f.db.raw.prepare("UPDATE welcome_claims SET expires_at='2000-01-01T00:00:00.000Z'").run();
      return await f.db.batch(statements);
    },
  });
  assert.equal(
    (
      await guarded.assign({
        personId: f.person.id,
        committeeId: 'events',
        role: 'member',
        actorId: f.lead.id,
        operationId: 'expired',
        fromWelcome: true,
      })
    ).kind,
    'conflict',
  );
  assert.equal(
    f.db.raw.prepare('SELECT 1 FROM integration_outbox WHERE id=?').get('expired'),
    undefined,
  );
  f.db.raw.close();
});
