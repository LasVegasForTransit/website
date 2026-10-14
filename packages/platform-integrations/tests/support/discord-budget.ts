import assert from 'node:assert/strict';
import type test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { enqueueOperation } from '@lasvegasfortransit/platform-storage/outbox';
import { queryBudget } from '@lasvegasfortransit/platform-storage/query-budget';
import { reconcileDiscordPending } from '../../src/discord-runner';
export const memberRoleId = '333333333333333333';
export const unrelatedRoleId = '777777777777777777';
export async function discordBudgetFixture(t: test.TestContext, count: number) {
  const db = memoryDb();
  t.after(() => db.raw.close());
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'multiple@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  const identityId = '222222222222222222';
  await people.linkIdentity(person.id, {
    platform: 'discord',
    externalId: identityId,
    linkMethod: 'self_linked',
  });
  await db
    .prepare(
      "INSERT INTO reconcile_generations(person_id,target_id,generation) VALUES(?,'person',1)",
    )
    .bind(person.id)
    .run();
  const stamp = new Date().toISOString();
  const roleIds = Array.from(
    { length: count },
    (_, index) => `8${String(index).padStart(17, '0')}`,
  );
  for (const [index, roleId] of roleIds.entries()) {
    const id = `budget-${index}`;
    await db
      .prepare('INSERT INTO committees(id,name,discord_role_id,updated_at) VALUES(?,?,?,?)')
      .bind(id, id, roleId, stamp)
      .run();
    await db
      .prepare(
        "INSERT INTO committee_assignments(id,person_id,committee_id,role,started_at,assigned_by,updated_at) VALUES(?,?,?,'member',?,?,?)",
      )
      .bind(id, person.id, id, stamp, person.id, stamp)
      .run();
  }
  await enqueueOperation(db, {
    id: 'budget-fixture',
    kind: 'person_reconcile',
    personId: person.id,
    targetId: 'person',
    generation: 1,
    payload: {},
  });
  const roles = new Set([unrelatedRoleId]);
  const changes: string[] = [];
  const state = { absent: false, failure: false, ignoreWrites: false, offset: 1000 };
  const fetcher: typeof fetch = (input, init) => {
    assert.ok(typeof input === 'string');
    const roleId = new URL(input).pathname.split('/').at(-1);
    assert.ok(roleId);
    if (init?.method === 'PUT' || init?.method === 'DELETE') {
      assert.notEqual(roleId, unrelatedRoleId);
      if (state.failure)
        return Promise.resolve(Response.json({ retry_after: 1.25, global: true }, { status: 429 }));
      if (!state.ignoreWrites) {
        if (init.method === 'PUT') roles.add(roleId);
        else roles.delete(roleId);
      }
      changes.push(`${init.method} ${roleId}`);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (state.absent) return Promise.resolve(Response.json({ code: 10007 }, { status: 404 }));
    return Promise.resolve(
      Response.json({
        user: { id: identityId, username: 'fixture', avatar: null },
        roles: [...roles],
        pending: false,
        nick: null,
      }),
    );
  };
  const now = () => new Date(Date.now() + state.offset);
  const run = async () => {
    const budget = queryBudget(db, 50);
    const result = await reconcileDiscordPending(budget.db, {
      configuration: {
        environment: 'preview',
        guildId: '111111111111111111',
        productionGuildId: '999999999999999999',
        botToken: 'fixture-only',
      },
      applicationId: '666666666666666666',
      memberRoleId,
      fetch: fetcher,
      limit: 1,
      changeLimit: 1,
      now,
    });
    assert.ok(budget.queries <= 50);
    assert.ok(budget.largestBindings <= 100);
    assert.equal(
      db.raw
        .prepare("SELECT count(*) AS n FROM provider_account_leases WHERE provider='discord'")
        .get()?.n,
      0,
    );
    return result;
  };
  return { db, people, person, roles, changes, roleIds, run, now, state };
}
