import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonService } from '../src/person-service';
import { linkWorkspaceIdentity } from '../src/workspace-link';
import { bootstrapStaffAdmin, loadActor } from '../src/staff-roles';
import { CommitteeService } from '../src/committees';
import { CommitteeApplicationService } from '../src/committee-applications';
import { memoryDb } from './support/db';

const now = new Date('2026-11-20T12:00:00.000Z');
async function fixture() {
  const db = memoryDb();
  const people = new PersonService(db);
  const join = async (email: string, givenName: string) =>
    (
      await people.upsertFromSource({
        source: 'join_form',
        fields: { email, given_name: givenName },
        consent: {
          scope: 'newsletter',
          source: 'join_form',
          method: 'checkbox',
          wordingVersion: 'join-form-v1',
        },
      })
    ).person;
  const admin = await join('admin@example.org', 'Admin');
  const lead = await join('lead@example.org', 'Lead');
  const applicant = await join('applicant@example.org', 'Applicant');
  await linkWorkspaceIdentity(db, {
    workspace: {
      subject: 'admin-subject',
      email: 'admin@lasvegasfortransit.org',
      givenName: null,
      familyName: null,
    },
    personId: admin.id,
    method: 'self_linked',
    operationId: 'link-admin',
  });
  await bootstrapStaffAdmin(db, {
    presidentPersonId: admin.id,
    workspaceSubject: 'admin-subject',
    performedBy: 'maintainer-fixture',
    operationId: 'bootstrap',
  });
  // Committees start closed to member asks; an administrator opens Events and Media.
  await db
    .prepare(`UPDATE committees SET taking_applications=1 WHERE id IN ('events','media')`)
    .run();
  const committees = new CommitteeService(db);
  assert.equal(
    (
      await committees.assign({
        personId: lead.id,
        committeeId: 'events',
        role: 'lead',
        actorId: admin.id,
        operationId: 'lead-events',
      })
    ).kind,
    'ok',
  );
  const actor = async (id: string) => {
    const loaded = await loadActor(db, id);
    assert.ok(loaded);
    return loaded;
  };
  return {
    db,
    admin,
    lead,
    applicant,
    actor,
    service: new CommitteeApplicationService(db),
  };
}
const role = {
  committeeId: 'events',
  roleSlug: 'events-coordinator',
  roleTitle: 'Events Coordinator',
};
const input = { note: 'I run a book club.', availability: 'Weeknights' };

void test('a member applies once per role; the committee lead sees it and acceptance assigns the committee', async () => {
  const f = await fixture();
  const submitted = await f.service.submit(f.applicant.id, role, input, now);
  assert.equal(submitted.kind, 'ok');
  assert.equal((await f.service.submit(f.applicant.id, role, input, now)).kind, 'duplicate');
  assert.deepEqual(
    (await f.service.forPerson(f.applicant.id)).map((a) => [a.roleTitle, a.state]),
    [['Events Coordinator', 'submitted']],
  );

  const lead = await f.actor(f.lead.id);
  const later = new Date(now.getTime() + 4 * 86_400_000);
  const [queued] = await f.service.queue(lead, later);
  assert.ok(queued);
  assert.equal(queued.note, 'I run a book club.');
  assert.equal(queued.overdue, true);

  const accepted = await f.service.accept(
    lead,
    submitted.id,
    { committeeId: '', operationId: 'accept-1', note: 'Welcome!' },
    later,
  );
  assert.equal(accepted.kind, 'ok');
  const assignment = f.db.raw
    .prepare(
      "SELECT id,role FROM committee_assignments WHERE person_id=? AND committee_id='events' AND ended_at IS NULL",
    )
    .get(f.applicant.id);
  assert.equal(assignment?.role, 'member');
  assert.equal(
    f.db.raw
      .prepare(
        "SELECT count(*) AS n FROM integration_outbox WHERE person_id=? AND kind='committee_reconcile'",
      )
      .get(f.applicant.id)?.n,
    1,
    'access follows the ordinary committee reconciliation',
  );
  const [mine] = await f.service.forPerson(f.applicant.id);
  assert.ok(mine);
  assert.equal(mine.state, 'accepted');
  assert.equal(mine.decisionNote, 'Welcome!');
  assert.equal(
    (
      await f.service.accept(
        lead,
        submitted.id,
        { committeeId: '', operationId: 'accept-1', note: '' },
        later,
      )
    ).kind,
    'conflict',
  );
  assert.equal((await f.service.queue(lead, later)).length, 0);
  assert.equal((await f.service.decided(lead, later))[0]?.decidedByName, 'Lead');
  f.db.raw.close();
});

void test('leads only see and decide their committees; roles without a committee go to administrators', async () => {
  const f = await fixture();
  const media = await f.service.submit(
    f.applicant.id,
    { committeeId: 'media', roleSlug: null, roleTitle: null },
    input,
    now,
  );
  const unplaced = await f.service.submit(
    f.applicant.id,
    {
      committeeId: null,
      roleSlug: 'development-coordinator',
      roleTitle: 'Development Coordinator',
    },
    input,
    now,
  );
  assert.ok(media.kind === 'ok' && unplaced.kind === 'ok');
  const lead = await f.actor(f.lead.id);
  const admin = await f.actor(f.admin.id);
  assert.equal((await f.service.queue(lead, now)).length, 0);
  assert.equal(await f.service.entry(lead, media.id, now), null);
  assert.equal(
    (await f.service.decline(lead, media.id, { operationId: 'd1', note: '' }, now)).kind,
    'not_found',
  );
  assert.equal(
    (
      await f.service.accept(
        lead,
        unplaced.id,
        { committeeId: 'events', operationId: 'a1', note: '' },
        now,
      )
    ).kind,
    'not_found',
  );
  assert.equal((await f.service.queue(admin, now)).length, 2);
  assert.equal(
    (
      await f.service.accept(
        admin,
        unplaced.id,
        { committeeId: 'education', operationId: 'a2', note: '' },
        now,
      )
    ).kind,
    'ok',
  );
  assert.equal(
    (await f.service.decline(admin, media.id, { operationId: 'd2', note: 'Full for now' }, now))
      .kind,
    'ok',
  );
  const states = (await f.service.forPerson(f.applicant.id)).map((a) => [a.committeeId, a.state]);
  assert.deepEqual(states.sort(), [
    ['education', 'accepted'],
    ['media', 'declined'],
  ]);
  assert.equal(
    f.db.raw
      .prepare(
        "SELECT count(*) AS n FROM staff_audits WHERE action='committee_application.decline'",
      )
      .get()?.n,
    1,
  );
  f.db.raw.close();
});

void test('accepting someone already on the committee records the existing assignment', async () => {
  const f = await fixture();
  const submitted = await f.service.submit(f.applicant.id, role, input, now);
  assert.ok(submitted.kind === 'ok');
  await new CommitteeService(f.db).assign({
    personId: f.applicant.id,
    committeeId: 'events',
    role: 'member',
    actorId: f.admin.id,
    operationId: 'manual',
  });
  const lead = await f.actor(f.lead.id);
  assert.equal(
    (
      await f.service.accept(
        lead,
        submitted.id,
        { committeeId: '', operationId: 'late', note: '' },
        now,
      )
    ).kind,
    'ok',
  );
  assert.equal(
    (
      await f.service.submit(
        f.applicant.id,
        { committeeId: 'events', roleSlug: null, roleTitle: null },
        input,
        now,
      )
    ).kind,
    'already_on_committee',
  );
  f.db.raw.close();
});

void test('members withdraw their own applications, invalid input and closed committees are refused, erasure removes them', async () => {
  const f = await fixture();
  assert.equal(
    (await f.service.submit(f.applicant.id, { ...role, roleSlug: 'Bad Slug' }, input, now)).kind,
    'invalid',
  );
  assert.equal(
    (
      await f.service.submit(
        f.applicant.id,
        role,
        { note: 'x'.repeat(2001), availability: '' },
        now,
      )
    ).kind,
    'invalid',
  );
  f.db.raw.exec("UPDATE committees SET accepting_members=0 WHERE id='media'");
  assert.equal(
    (
      await f.service.submit(
        f.applicant.id,
        { committeeId: 'media', roleSlug: null, roleTitle: null },
        input,
        now,
      )
    ).kind,
    'unavailable',
  );
  const submitted = await f.service.submit(f.applicant.id, role, input, now);
  assert.ok(submitted.kind === 'ok');
  assert.equal(await f.service.withdraw(f.lead.id, submitted.id, now), false);
  assert.equal(await f.service.withdraw(f.applicant.id, submitted.id, now), true);
  assert.equal((await f.service.submit(f.applicant.id, role, input, now)).kind, 'ok');
  f.db.raw
    .prepare('UPDATE person_keys SET deleted_at=?,erased_at=? WHERE id=?')
    .run(now.toISOString(), now.toISOString(), f.applicant.id);
  assert.equal(
    f.db.raw
      .prepare('SELECT count(*) AS n FROM committee_applications WHERE person_id=?')
      .get(f.applicant.id)?.n,
    0,
  );
  f.db.raw.close();
});

void test('a posted role takes applications even when its committee is closed to asks, committees start closed, and an unknown committee is left for the decider', async () => {
  const f = await fixture();
  await f.db.prepare(`UPDATE committees SET taking_applications=0 WHERE id='events'`).run();
  assert.equal((await f.service.submit(f.applicant.id, role, input, now)).kind, 'ok');
  assert.equal(
    (
      await f.service.submit(
        f.applicant.id,
        { committeeId: 'events', roleSlug: null, roleTitle: null },
        input,
        now,
      )
    ).kind,
    'unavailable',
  );
  const orphan = await f.service.submit(
    f.applicant.id,
    { committeeId: 'no-such-team', roleSlug: 'grant-writer', roleTitle: 'Grant Writer' },
    input,
    now,
  );
  assert.equal(orphan.kind, 'ok');
  const mine = await f.service.forPerson(f.applicant.id);
  assert.equal(mine.find((entry) => entry.roleSlug === 'grant-writer')?.committeeId, null);
  // Only administrators see an application with no committee.
  const leadQueue = await f.service.queue(await f.actor(f.lead.id), now);
  assert.equal(
    leadQueue.some((entry) => entry.roleSlug === 'grant-writer'),
    false,
  );
  const adminQueue = await f.service.queue(await f.actor(f.admin.id), now);
  assert.equal(
    adminQueue.some((entry) => entry.roleSlug === 'grant-writer'),
    true,
  );
  assert.deepEqual([...(await f.service.memberCommittees(f.lead.id))], ['events']);
  assert.equal(
    (
      await f.service.submit(
        f.applicant.id,
        { committeeId: 'board', roleSlug: null, roleTitle: null },
        input,
        now,
      )
    ).kind,
    'unavailable',
  );
  assert.deepEqual(
    (await f.service.openCommittees()).map((committee) => committee.id),
    ['media'],
  );
});
