import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFixture } from './support/merge-fixture';
import { loadActor } from '../src/staff-roles';
import { markOperationFailed } from '../src/outbox';
async function fixture() {
  const view = await import('../src/access-view').catch(() => null);
  const observations = await import('../src/access-observations').catch(() => null);
  const recovery = await import('../src/access-recovery').catch(() => null);
  assert.ok(view, 'staff must distinguish saved assignments from observed provider access');
  assert.ok(observations, 'provider confirmations must be bounded and tied to current accounts');
  assert.ok(recovery, 'access recovery must reject removed and superseded grants');
  const f = await mergeFixture();
  await f.people.linkIdentity(f.survivor.id, {
    platform: 'discord',
    externalId: '123',
    linkMethod: 'self_linked',
  });
  f.db.raw.prepare("UPDATE committees SET discord_role_id='456' WHERE id='events'").run();
  const assigned = await f.committees.assign({
    personId: f.survivor.id,
    committeeId: 'events',
    role: 'member',
    actorId: f.admin.id,
    operationId: 'grant',
  });
  assert.equal(assigned.kind, 'ok');
  const configuration = { discord: { configured: true, contextId: 'guild', memberRoleId: '789' } };
  const stamp = new Date();
  const observation = {
    personId: f.survivor.id,
    targetId: 'events',
    provider: 'discord' as const,
    identityId: '123',
    identityEmail: null,
    resourceId: '456',
    contextId: 'guild',
    generation: 1,
    expectedAccess: true,
    state: 'granted' as const,
    observedAt: stamp.toISOString(),
    expiresAt: new Date(stamp.getTime() + 300_000).toISOString(),
  };
  return {
    ...f,
    ...view,
    ...observations,
    ...recovery,
    assigned: assigned.value,
    configuration,
    observation,
  };
}
void test('a newer failed read wins when two observations have the same millisecond timestamp', async () => {
  const f = await fixture();
  const input = f.observation;
  for (const [id, state, failure] of [
    ['01K0000000ZZZZZZZZZZZZZZZZ', 'granted', null],
    ['01K00000000000000000000000', 'unknown', 'permission_denied'],
  ] as const) {
    f.db.raw
      .prepare(
        `INSERT INTO access_observations(id,person_id,target_id,provider,identity_id,identity_email,resource_id,context_id,generation,expected_access,state,failure,observed_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.personId,
        input.targetId,
        input.provider,
        input.identityId,
        input.identityEmail,
        input.resourceId,
        input.contextId,
        input.generation,
        1,
        state,
        failure,
        input.observedAt,
        input.expiresAt,
      );
  }
  const rows = await f.listAccess(f.db, f.actor, {
    personId: f.survivor.id,
    configuration: f.configuration,
  });
  const access = rows.items.find((row) => row.targetId === 'events')?.discord;
  assert.equal(access?.state, 'unknown');
  assert.equal(access.reason, 'permission_denied');
});
void test('Discord links inferred from email cannot carry verified server-role proof', async () => {
  const f = await fixture();
  assert.equal(await f.recordAccessObservation(f.db, f.observation), true);
  await f.db
    .prepare(
      "UPDATE identities SET link_method='verified_email' WHERE person_id=? AND platform='discord'",
    )
    .bind(f.survivor.id)
    .run();
  const rows = await f.listAccess(f.db, f.actor, {
    personId: f.survivor.id,
    configuration: f.configuration,
  });
  assert.equal(rows.items.find((row) => row.targetId === 'events')?.discord.state, 'unknown');
  assert.equal(await f.recordAccessObservation(f.db, f.observation), false);
});
void test('only a fresh current provider confirmation proves access; missing config, read failures and changes do not', async () => {
  const f = await fixture();
  const rows = async (configuration = f.configuration, now = new Date()) =>
    (await f.listAccess(f.db, f.actor, { personId: f.survivor.id, configuration, now })).items;
  assert.equal((await rows()).find((r) => r.targetId === 'events')?.discord.state, 'unknown');
  assert.equal(await f.recordAccessObservation(f.db, f.observation), true);
  assert.equal((await rows()).find((r) => r.targetId === 'events')?.discord.state, 'granted');
  assert.equal(
    (await rows({ discord: { ...f.configuration.discord, configured: false } })).find(
      (r) => r.targetId === 'events',
    )?.discord.state,
    'unknown',
  );
  assert.equal(
    (await rows(f.configuration, new Date(Date.now() + 301_000))).find(
      (r) => r.targetId === 'events',
    )?.discord.state,
    'unknown',
  );
  await f.recordAccessObservation(f.db, {
    ...f.observation,
    state: 'unknown',
    failure: 'provider_unavailable',
    observedAt: new Date().toISOString(),
  });
  assert.equal((await rows()).find((r) => r.targetId === 'events')?.discord.state, 'unknown');
  await f.committees.endAssignment(f.assigned.id, 'stepped_back', f.admin.id, 'remove');
  assert.equal(await f.recordAccessObservation(f.db, f.observation), false);
  assert.equal((await rows()).find((r) => r.targetId === 'events')?.expectedAccess, false);
  assert.equal((await rows()).find((r) => r.targetId === 'events')?.discord.state, 'unknown');
  const removedAt = new Date();
  assert.equal(
    await f.recordAccessObservation(f.db, {
      ...f.observation,
      generation: 2,
      expectedAccess: false,
      state: 'absent',
      observedAt: removedAt.toISOString(),
      expiresAt: new Date(removedAt.getTime() + 300_000).toISOString(),
    }),
    true,
  );
  assert.equal((await rows()).find((r) => r.targetId === 'events')?.discord.state, 'absent');
  f.db.raw.close();
});
void test('retries are administrator-only and only retry the current reconciliation, including pending removals', async () => {
  const f = await fixture();
  const lead = await f.create('lead@example.invalid', 'Lead');
  await f.committees.assign({
    personId: lead.id,
    committeeId: 'events',
    role: 'lead',
    actorId: f.admin.id,
    operationId: 'lead',
  });
  const actor = await loadActor(f.db, lead.id);
  assert.ok(actor);
  await markOperationFailed(f.db, 'grant', 'permission_denied');
  assert.equal((await f.requestAccessRetry(f.db, actor, 'grant')).kind, 'forbidden');
  assert.equal((await f.requestAccessRetry(f.db, f.actor, 'grant')).kind, 'ok');
  await f.committees.endAssignment(f.assigned.id, 'stepped_back', f.admin.id, 'remove');
  await markOperationFailed(f.db, 'grant', 'provider_unavailable');
  assert.equal((await f.requestAccessRetry(f.db, f.actor, 'grant')).kind, 'conflict');
  await markOperationFailed(f.db, 'remove', 'provider_unavailable');
  assert.equal((await f.requestAccessRetry(f.db, f.actor, 'remove')).kind, 'ok');
  assert.equal(
    f.db.raw.prepare('SELECT ended_at FROM committee_assignments WHERE id=?').get(f.assigned.id)
      ?.ended_at !== null,
    true,
  );
  f.db.raw.close();
});
void test('access and history use current committee scope even for people shared with another committee', async () => {
  const f = await fixture();
  const lead = await f.create('lead@example.invalid', 'Lead');
  await f.committees.assign({
    personId: lead.id,
    committeeId: 'events',
    role: 'lead',
    actorId: f.admin.id,
    operationId: 'lead',
  });
  await f.committees.assign({
    personId: f.survivor.id,
    committeeId: 'advocacy',
    role: 'member',
    actorId: f.admin.id,
    operationId: 'other',
  });
  const actor = await loadActor(f.db, lead.id);
  assert.ok(actor);
  const rows = await f.listAccess(f.db, actor, { personId: f.survivor.id });
  assert.deepEqual(
    rows.items.map((r) => r.targetId),
    ['events', 'person'],
  );
  const history = await f.accessHistory(f.db, actor, { personId: f.survivor.id });
  assert.deepEqual(
    history.items.map((r) => r.committeeId),
    ['events'],
  );
  assert.equal(
    (
      await f.removeAssignedAccess(f.db, actor, {
        assignmentId: f.assigned.id,
        reason: 'removed',
        operationId: 'deny',
      })
    ).kind,
    'forbidden',
  );
  const removed = await f.removeAssignedAccess(f.db, f.actor, {
    assignmentId: f.assigned.id,
    reason: 'removed',
    operationId: 'admin-remove',
  });
  assert.equal(removed.kind, 'ok');
  assert.deepEqual((await f.listAccess(f.db, actor, { personId: f.survivor.id })).items, []);
  assert.deepEqual((await f.accessHistory(f.db, actor, { personId: f.survivor.id })).items, []);
  f.db.raw.close();
});
void test('provider observations cannot survive changed accounts, mappings, contexts or membership', async () => {
  const f = await fixture();
  const row = async () =>
    (
      await f.listAccess(f.db, f.actor, { personId: f.survivor.id, configuration: f.configuration })
    ).items.find((item) => item.targetId === 'events');
  await f.recordAccessObservation(f.db, f.observation);
  const differentContext = { discord: { ...f.configuration.discord, contextId: 'another-guild' } };
  assert.equal(
    (
      await f.listAccess(f.db, f.actor, {
        personId: f.survivor.id,
        configuration: differentContext,
      })
    ).items.find((item) => item.targetId === 'events')?.discord.state,
    'unknown',
  );
  f.db.raw
    .prepare("UPDATE identities SET external_id='changed' WHERE person_id=? AND platform='discord'")
    .run(f.survivor.id);
  assert.equal(await f.recordAccessObservation(f.db, f.observation), false);
  assert.equal((await row())?.discord.state, 'unknown');
  f.db.raw
    .prepare("UPDATE identities SET external_id='123' WHERE person_id=? AND platform='discord'")
    .run(f.survivor.id);
  f.db.raw.prepare("UPDATE committees SET discord_role_id='999' WHERE id='events'").run();
  assert.equal(await f.recordAccessObservation(f.db, f.observation), false);
  assert.equal((await row())?.discord.state, 'unknown');
  f.db.raw.prepare("UPDATE committees SET discord_role_id='456' WHERE id='events'").run();
  await f.people.withdrawConsent(f.survivor.id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: new Date().toISOString(),
  });
  assert.equal((await row())?.expectedAccess, false);
  assert.equal((await row())?.discord.state, 'unknown');
  assert.equal(await f.recordAccessObservation(f.db, f.observation), false);
  f.db.raw.close();
});
void test('access recovery is atomic and cannot retain authority after administrator removal', async () => {
  const f = await fixture();
  await f.committees.assign({
    personId: f.admin.id,
    committeeId: 'events',
    role: 'lead',
    actorId: f.admin.id,
    operationId: 'admin-lead',
  });
  await markOperationFailed(f.db, 'grant', 'provider_unavailable');
  f.db.raw.exec(
    "CREATE TRIGGER reject_recovery_audit BEFORE INSERT ON staff_audits WHEN NEW.action='access.retry' BEGIN SELECT RAISE(ABORT,'fixture rejection'); END;",
  );
  await assert.rejects(() => f.requestAccessRetry(f.db, f.actor, 'grant'), /fixture rejection/);
  assert.equal(
    f.db.raw.prepare("SELECT state FROM integration_outbox WHERE id='grant'").get()?.state,
    'retry',
  );
  f.db.raw.exec('DROP TRIGGER reject_recovery_audit');
  const started = {
    prepare: (sql: string) => f.db.prepare(sql),
    batch: async (statements: Parameters<typeof f.db.batch>[0]) => {
      const result = await f.db.batch(statements);
      f.db.raw
        .prepare("UPDATE integration_outbox SET state='running',updated_at=? WHERE id='grant'")
        .run(new Date().toISOString());
      return result;
    },
  };
  assert.equal((await f.requestAccessRetry(started, f.actor, 'grant')).kind, 'ok');
  await markOperationFailed(f.db, 'grant', 'provider_unavailable');
  f.db.raw
    .prepare(
      'INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES (?, ?, ?)',
    )
    .run(f.survivor.id, 'fixture', new Date().toISOString());
  const revoked = {
    prepare: (sql: string) => f.db.prepare(sql),
    batch: async (statements: Parameters<typeof f.db.batch>[0]) => {
      f.db.raw.prepare('DELETE FROM staff_administrators WHERE person_id=?').run(f.admin.id);
      return await f.db.batch(statements);
    },
  };
  assert.equal(
    (
      await f.removeAssignedAccess(revoked, f.actor, {
        assignmentId: f.assigned.id,
        reason: 'removed',
        operationId: 'revoked',
      })
    ).kind,
    'conflict',
  );
  assert.equal(
    f.db.raw.prepare('SELECT ended_at FROM committee_assignments WHERE id=?').get(f.assigned.id)
      ?.ended_at,
    null,
  );
  assert.equal((await f.requestAccessRetry(f.db, f.actor, 'grant')).kind, 'forbidden');
  f.db.raw.close();
});
void test('access history excludes events older than three years and paginates without revealing other teams', async () => {
  const f = await fixture();
  await f.committees.changeRole(f.assigned.id, 'lead', f.admin.id, 'promote');
  f.db.raw
    .prepare(
      "INSERT INTO staff_audits(id,actor_id,action,target_id,details,occurred_at) VALUES ('old',?,'access.retry',?,'{\"targetId\":\"events\"}','2020-01-01T00:00:00.000Z')",
    )
    .run(f.admin.id, f.survivor.id);
  const first = await f.accessHistory(f.db, f.actor, { personId: f.survivor.id, limit: 1 });
  assert.equal(first.items.length, 1);
  assert.ok(first.nextCursor);
  const next = await f.accessHistory(f.db, f.actor, {
    personId: f.survivor.id,
    limit: 1,
    cursor: first.nextCursor,
  });
  assert.equal(next.items.length, 1);
  assert.notEqual(next.items[0]?.id, first.items[0]?.id);
  assert.equal(next.nextCursor, null);
  await assert.rejects(() => f.listAccess(f.db, f.actor, { cursor: 'garbage' }));
  f.db.raw.close();
});
void test('ambiguous linked accounts and overlong or future confirmations remain unconfirmed', async () => {
  const f = await fixture();
  assert.equal(
    await f.recordAccessObservation(f.db, {
      ...f.observation,
      expiresAt: new Date(Date.parse(f.observation.observedAt) + 300_001).toISOString(),
    }),
    false,
  );
  const future = new Date(Date.now() + 1000).toISOString();
  assert.equal(
    await f.recordAccessObservation(f.db, {
      ...f.observation,
      observedAt: future,
      expiresAt: new Date(Date.parse(future) + 300_000).toISOString(),
    }),
    false,
  );
  await f.recordAccessObservation(f.db, f.observation);
  await f.people.linkIdentity(f.survivor.id, {
    platform: 'discord',
    externalId: 'another',
    linkMethod: 'self_linked',
  });
  assert.equal(await f.recordAccessObservation(f.db, f.observation), false);
  const row = (
    await f.listAccess(f.db, f.actor, { personId: f.survivor.id, configuration: f.configuration })
  ).items.find((item) => item.targetId === 'events');
  assert.equal(row?.discord.state, 'unknown');
  assert.equal(row.discord.reason, 'ambiguous_account');
  assert.equal(row.discordConnected, true);
  f.db.raw.close();
});
