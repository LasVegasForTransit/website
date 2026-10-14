import assert from 'node:assert/strict';
import test from 'node:test';
import {
  googleOverviewFixture,
  groupEmail,
  consoleGroupEmail,
  now,
} from './support/google-group-overview-fixture';
import { getGoogleGroupReview } from '../src/google-group-overview';
async function api() {
  const loaded = await import('../src/google-group-actions').catch(() => null);
  assert.ok(loaded, 'staff need current, attributed corrections from the Google group review');
  return loaded;
}
async function fixture() {
  const f = await googleOverviewFixture();
  const review = await getGoogleGroupReview(f.db, f.actor, { ...f.query, groupEmail });
  assert.ok(review);
  const input = {
    groupEmail,
    personId: f.survivor.id,
    identityId: 'expected-user',
    expectedSnapshot: JSON.stringify([
      review.summary.groupId,
      review.summary.contentHash,
      review.summary.startedAt,
    ]),
    expectedAccess: true,
    operationId: 'restore-google',
    configuration: f.configuration,
    consoleGroupEmail,
  };
  return { ...f, input };
}
void test('restoring missing access queues current work and records the actor without changing consent', async () => {
  const { requestGoogleGroupAccessUpdate } = await api();
  const f = await fixture();
  const before = f.db.raw.prepare('SELECT * FROM consent_records ORDER BY id').all();
  assert.equal((await requestGoogleGroupAccessUpdate(f.db, f.actor, f.input, now)).kind, 'ok');
  const reviewed = await getGoogleGroupReview(f.db, f.actor, { ...f.query, groupEmail });
  assert.equal(
    reviewed?.items.find((person) => person.personId === f.survivor.id)?.requestState,
    'queued',
  );
  assert.equal(
    reviewed.items.find((person) => person.personId === f.survivor.id)?.state,
    'missing',
  );
  const operation = f.db.raw
    .prepare('SELECT * FROM integration_outbox WHERE id=?')
    .get(f.input.operationId);
  assert.equal(operation?.kind, 'person_reconcile');
  assert.equal(operation.state, 'queued');
  const generation = f.db.raw
    .prepare(
      "SELECT generation FROM reconcile_generations WHERE person_id=? AND target_id='person'",
    )
    .get(f.survivor.id);
  assert.equal(operation.generation, generation?.generation);
  const audit = f.db.raw
    .prepare(
      "SELECT actor_id,details FROM staff_audits WHERE operation_id=? AND action='access.group_update'",
    )
    .get(f.input.operationId);
  assert.equal(audit?.actor_id, f.admin.id);
  assert.match(String(audit.details), /missing_access/);
  assert.deepEqual(f.db.raw.prepare('SELECT * FROM consent_records ORDER BY id').all(), before);
});
void test('removing unexpected access preserves assignments and membership', async () => {
  const { requestGoogleGroupAccessUpdate } = await api();
  const f = await fixture();
  const before = f.db.raw.prepare('SELECT * FROM committee_assignments ORDER BY id').all();
  const input = {
    ...f.input,
    personId: f.extra.id,
    identityId: 'extra-user',
    expectedAccess: false,
    operationId: 'remove-google',
  };
  assert.equal((await requestGoogleGroupAccessUpdate(f.db, f.actor, input, now)).kind, 'ok');
  assert.deepEqual(
    f.db.raw.prepare('SELECT * FROM committee_assignments ORDER BY id').all(),
    before,
  );
  assert.equal(
    f.db.raw.prepare('SELECT membership_status FROM people WHERE id=?').get(f.extra.id)
      ?.membership_status,
    'member',
  );
});
void test('an applied request replays once and cannot be reused for another person', async () => {
  const { requestGoogleGroupAccessUpdate } = await api();
  const f = await fixture();
  assert.equal((await requestGoogleGroupAccessUpdate(f.db, f.actor, f.input, now)).kind, 'ok');
  const first = f.db.raw
    .prepare(
      "SELECT generation FROM reconcile_generations WHERE person_id=? AND target_id='person'",
    )
    .get(f.survivor.id);
  assert.equal((await requestGoogleGroupAccessUpdate(f.db, f.actor, f.input, now)).kind, 'ok');
  assert.deepEqual(
    f.db.raw
      .prepare(
        "SELECT generation FROM reconcile_generations WHERE person_id=? AND target_id='person'",
      )
      .get(f.survivor.id),
    first,
  );
  assert.equal(
    (
      await requestGoogleGroupAccessUpdate(
        f.db,
        f.actor,
        { ...f.input, personId: f.extra.id, identityId: 'extra-user', expectedAccess: false },
        now,
      )
    ).kind,
    'conflict',
  );
  assert.equal(
    f.db.raw
      .prepare(
        "SELECT count(*) AS n FROM staff_audits WHERE operation_id=? AND action='access.group_update'",
      )
      .get(f.input.operationId)?.n,
    1,
  );
});
async function changedReview(f: Awaited<ReturnType<typeof fixture>>, change: string) {
  const input = { ...f.input };
  let at = now;
  if (change === 'stale') at = new Date('2026-10-14T12:06:00.000Z');
  if (change === 'snapshot') input.expectedSnapshot = '["wrong"]';
  if (change === 'failure')
    f.db.raw
      .prepare(
        "INSERT INTO google_group_check_failures(context_id,group_email,failure,started_at) VALUES('Cpreview',?,'unknown','2026-10-14T12:00:04.000Z')",
      )
      .run(groupEmail);
  if (change === 'config') input.configuration = { ...f.configuration, configured: false };
  if (change === 'console') input.consoleGroupEmail = groupEmail;
  if (change === 'mapping')
    f.db.raw.prepare("UPDATE committees SET workspace_group_email=NULL WHERE id='events'").run();
  if (change === 'identity')
    f.db.raw
      .prepare("UPDATE identities SET person_id=? WHERE external_id='expected-user'")
      .run(f.extra.id);
  if (change === 'member')
    await f.people.withdrawConsent(f.survivor.id, {
      scope: 'newsletter',
      source: 'account',
      withdrawnAt: now.toISOString(),
    });
  return { input, at };
}
void test('stale, changed, failed, read-only and unconfigured checks cannot queue corrections', async () => {
  const { requestGoogleGroupAccessUpdate } = await api();
  for (const change of [
    'stale',
    'snapshot',
    'failure',
    'config',
    'console',
    'mapping',
    'identity',
    'member',
  ]) {
    const f = await fixture();
    const { input, at } = await changedReview(f, change);
    assert.equal(
      (await requestGoogleGroupAccessUpdate(f.db, f.actor, input, at)).kind,
      'conflict',
      change,
    );
    assert.equal(
      f.db.raw
        .prepare('SELECT count(*) AS n FROM integration_outbox WHERE id=?')
        .get(input.operationId)?.n,
      0,
      change,
    );
  }
});
void test('a current committee assignment prevents an obsolete removal request', async () => {
  const { requestGoogleGroupAccessUpdate } = await api();
  const f = await fixture();
  await f.committees.assign({
    personId: f.extra.id,
    committeeId: 'events',
    role: 'member',
    actorId: f.admin.id,
    operationId: 'keep-google',
  });
  assert.equal(
    (
      await requestGoogleGroupAccessUpdate(
        f.db,
        f.actor,
        { ...f.input, personId: f.extra.id, identityId: 'extra-user', expectedAccess: false },
        now,
      )
    ).kind,
    'conflict',
  );
});
void test('administrator revocation immediately before the batch leaves no partial request', async () => {
  const { requestGoogleGroupAccessUpdate } = await api();
  const f = await fixture();
  f.db.raw
    .prepare(
      'INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES(?,?,?)',
    )
    .run(f.survivor.id, 'fixture', now.toISOString());
  const before = f.db.raw
    .prepare('SELECT * FROM reconcile_generations ORDER BY person_id,target_id')
    .all();
  const db = {
    ...f.db,
    batch: async (statements: Parameters<typeof f.db.batch>[0]) => {
      f.db.raw.prepare('DELETE FROM staff_administrators WHERE person_id=?').run(f.admin.id);
      return await f.db.batch(statements);
    },
  };
  assert.notEqual((await requestGoogleGroupAccessUpdate(db, f.actor, f.input, now)).kind, 'ok');
  assert.deepEqual(
    f.db.raw.prepare('SELECT * FROM reconcile_generations ORDER BY person_id,target_id').all(),
    before,
  );
  assert.equal(
    f.db.raw
      .prepare('SELECT count(*) AS n FROM staff_operations WHERE operation_id=?')
      .get(f.input.operationId)?.n,
    0,
  );
});
void test('an audit failure rolls back the complete access request', async () => {
  const { requestGoogleGroupAccessUpdate } = await api();
  const f = await fixture();
  f.db.raw.exec(
    "CREATE TRIGGER fail_group_audit BEFORE INSERT ON staff_audits WHEN NEW.action='access.group_update' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END",
  );
  await assert.rejects(
    requestGoogleGroupAccessUpdate(f.db, f.actor, f.input, now),
    /fixture audit failure/,
  );
  assert.equal(
    f.db.raw
      .prepare('SELECT count(*) AS n FROM staff_operations WHERE operation_id=?')
      .get(f.input.operationId)?.n,
    0,
  );
  assert.equal(
    f.db.raw
      .prepare('SELECT count(*) AS n FROM integration_outbox WHERE id=?')
      .get(f.input.operationId)?.n,
    0,
  );
});
void test('adding a holder uses the canonical assignment workflow and current group mapping', async () => {
  const { assignGoogleGroupMember } = await api();
  const f = await fixture();
  const input = {
    ...f.input,
    personId: f.extra.id,
    identityId: 'extra-user',
    expectedAccess: false,
    committeeId: 'events',
    operationId: 'assign-google-holder',
  };
  assert.equal((await assignGoogleGroupMember(f.db, f.actor, input, now)).kind, 'ok');
  assert.equal(
    f.db.raw
      .prepare(
        "SELECT assigned_by FROM committee_assignments WHERE person_id=? AND committee_id='events' AND ended_at IS NULL",
      )
      .get(f.extra.id)?.assigned_by,
    f.admin.id,
  );
  assert.equal(
    f.db.raw
      .prepare(
        "SELECT actor_id FROM staff_audits WHERE operation_id=? AND action='committee.assign'",
      )
      .get(input.operationId)?.actor_id,
    f.admin.id,
  );
  const other = await fixture();
  const changed = {
    ...input,
    personId: other.extra.id,
    operationId: 'mapping-changed',
    expectedSnapshot: other.input.expectedSnapshot,
  };
  const db = {
    ...other.db,
    batch: async (statements: Parameters<typeof other.db.batch>[0]) => {
      other.db.raw
        .prepare("UPDATE committees SET workspace_group_email=NULL WHERE id='events'")
        .run();
      return await other.db.batch(statements);
    },
  };
  assert.equal((await assignGoogleGroupMember(db, other.actor, changed, now)).kind, 'conflict');
  assert.equal(
    other.db.raw
      .prepare(
        'SELECT count(*) AS n FROM committee_assignments WHERE person_id=? AND ended_at IS NULL',
      )
      .get(other.extra.id)?.n,
    0,
  );
});

void test('an existing outbox ID cannot swallow a new staff request', async () => {
  const { requestGoogleGroupAccessUpdate } = await api();
  const f = await fixture();
  f.db.raw
    .prepare(
      "INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at) VALUES(?,'person_reconcile',?,'person',1,'{}',?,?,?)",
    )
    .run(
      f.input.operationId,
      f.survivor.id,
      now.toISOString(),
      now.toISOString(),
      now.toISOString(),
    );
  assert.equal(
    (await requestGoogleGroupAccessUpdate(f.db, f.actor, f.input, now)).kind,
    'conflict',
  );
  assert.equal(
    f.db.raw
      .prepare('SELECT count(*) AS n FROM staff_operations WHERE operation_id=?')
      .get(f.input.operationId)?.n,
    0,
  );
});
