import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { PersonService } from '../src/person-service';
const guildId = '111111111111111111';
const memberRoleId = '333333333333333333';
const identityId = '222222222222222222';
const oldRole = '444444444444444444';
const currentRole = '555555555555555555';
async function fixture() {
  const module = await import('../src/discord-plan').catch(() => null);
  assert.ok(
    module,
    'Discord access must be derived from current canonical membership, identity and retained role mappings',
  );
  const db = memoryDb();
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'discord-plan@example.invalid', given_name: 'LVBT Name' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  await people.linkIdentity(person.id, {
    platform: 'discord',
    externalId: identityId,
    linkMethod: 'self_linked',
  });
  await db
    .prepare("UPDATE committees SET discord_role_id=? WHERE id='events'")
    .bind(currentRole)
    .run();
  for (const role of [oldRole, currentRole])
    await db
      .prepare(
        "INSERT INTO committee_account_mappings(committee_id,provider,external_id,recorded_at) VALUES('events','discord',?,?)",
      )
      .bind(role, new Date().toISOString())
      .run();
  await db
    .prepare(
      "INSERT INTO committee_assignments(id,person_id,committee_id,role,started_at,assigned_by,updated_at) VALUES('assignment',?,'events','member',?,?,?)",
    )
    .bind(person.id, new Date().toISOString(), person.id, new Date().toISOString())
    .run();
  return { ...module, db, people, person };
}
void test('desired roles include current membership and assignments, and retain every retired mapping for cleanup', async () => {
  const { db, person, loadDiscordPlan, discordPlanIsCurrent } = await fixture();
  const plan = await loadDiscordPlan(db, { personId: person.id, guildId, memberRoleId });
  assert.ok(plan);
  assert.deepEqual(plan.desiredRoleIds, [memberRoleId, currentRole]);
  assert.deepEqual(plan.managedRoleIds, [memberRoleId, oldRole, currentRole]);
  assert.equal(await discordPlanIsCurrent(db, plan), true);
  await db.prepare("UPDATE committees SET discord_role_id=NULL WHERE id='events'").run();
  assert.equal(await discordPlanIsCurrent(db, plan), false);
  const cleared = await loadDiscordPlan(db, { personId: person.id, guildId, memberRoleId });
  assert.deepEqual(cleared?.managedRoleIds, plan.managedRoleIds);
  assert.deepEqual(cleared.desiredRoleIds, [memberRoleId]);
});
void test('withdrawal, reassignment generations and changed stable ownership invalidate an in-flight plan', async () => {
  const { db, people, person, loadDiscordPlan, discordPlanIsCurrent } = await fixture();
  const input = { personId: person.id, guildId, memberRoleId };
  const plan = await loadDiscordPlan(db, input);
  assert.ok(plan);
  await db
    .prepare(
      "INSERT INTO reconcile_generations(person_id,target_id,generation) VALUES(?,'events',1)",
    )
    .bind(person.id)
    .run();
  assert.equal(await discordPlanIsCurrent(db, plan), false);
  const newer = await loadDiscordPlan(db, input);
  assert.ok(newer);
  await people.withdrawConsent(person.id, {
    scope: 'newsletter',
    source: 'member',
    withdrawnAt: new Date().toISOString(),
  });
  assert.equal(await discordPlanIsCurrent(db, newer), false);
  assert.deepEqual((await loadDiscordPlan(db, input))?.desiredRoleIds, []);
  const { person: owner } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'new-owner@example.invalid' },
  });
  await db
    .prepare("UPDATE identities SET person_id=? WHERE platform='discord' AND external_id=?")
    .bind(owner.id, identityId)
    .run();
  assert.equal(await loadDiscordPlan(db, input), null);
});
void test('ambiguous or unverified links and a member role overlapping a committee mapping fail closed', async () => {
  const { db, people, person, loadDiscordPlan } = await fixture();
  assert.equal(
    await loadDiscordPlan(db, { personId: person.id, guildId, memberRoleId: currentRole }),
    null,
  );
  await db
    .prepare("UPDATE identities SET link_method='verified_email' WHERE person_id=?")
    .bind(person.id)
    .run();
  assert.equal(await loadDiscordPlan(db, { personId: person.id, guildId, memberRoleId }), null);
  await db
    .prepare("UPDATE identities SET link_method='self_linked' WHERE person_id=?")
    .bind(person.id)
    .run();
  await people.linkIdentity(person.id, {
    platform: 'discord',
    externalId: '666666666666666666',
    linkMethod: 'self_linked',
  });
  assert.equal(await loadDiscordPlan(db, { personId: person.id, guildId, memberRoleId }), null);
});
