import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { PersonService } from '../src/person-service';
import { loadDiscordPlan, discordPlanIsCurrent } from '../src/discord-plan';

const guildId = '111111111111111111',
  memberRoleId = '333333333333333333';
const eastRole = '444444444444444444',
  westRole = '555555555555555555';
async function fixture() {
  const db = memoryDb();
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'region@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  await people.linkIdentity(person.id, {
    platform: 'discord',
    externalId: '222222222222222222',
    linkMethod: 'self_linked',
  });
  assert.ok(
    db.raw
      .prepare("SELECT 1 FROM pragma_table_info('people') WHERE name='discord_region_visible'")
      .get(),
    'region visibility must be a saved member preference',
  );
  db.raw.prepare('UPDATE regions SET discord_role_id=? WHERE id=?').run(eastRole, 'east_las_vegas');
  db.raw.prepare('UPDATE regions SET discord_role_id=? WHERE id=?').run(westRole, 'summerlin');
  await people.setRegion(person.id, 'east_las_vegas', 'member_choice');
  return { db, people, person, input: { personId: person.id, guildId, memberRoleId } };
}
void test('a linked member defaults to one region, hiding and changing it invalidate plans and queue reconciliation', async (context) => {
  const f = await fixture();
  context.after(() => f.db.raw.close());
  const plan = await loadDiscordPlan(f.db, f.input);
  assert.ok(plan);
  assert.deepEqual(plan.desiredRoleIds, [memberRoleId, eastRole]);
  assert.equal(
    plan.targets.find((t) => t.resourceId === eastRole)?.targetId,
    'region:east_las_vegas',
  );
  f.db.raw.prepare('UPDATE people SET discord_region_visible=0 WHERE id=?').run(f.person.id);
  assert.equal(await discordPlanIsCurrent(f.db, plan), false);
  assert.deepEqual((await loadDiscordPlan(f.db, f.input))?.desiredRoleIds, [memberRoleId]);
  await f.people.setRegion(f.person.id, 'summerlin', 'member_choice');
  f.db.raw.prepare('UPDATE people SET discord_region_visible=1 WHERE id=?').run(f.person.id);
  assert.deepEqual((await loadDiscordPlan(f.db, f.input))?.desiredRoleIds, [
    memberRoleId,
    westRole,
  ]);
  assert.ok(
    Number(
      f.db.raw
        .prepare(
          "SELECT count(*) AS n FROM integration_outbox WHERE person_id=? AND state='queued'",
        )
        .get(f.person.id)?.n,
    ) > 0,
  );
});
void test('region roles require current membership and a verified link and retain retired mappings for removal', async (context) => {
  const f = await fixture();
  context.after(() => f.db.raw.close());
  f.db.raw.prepare("UPDATE regions SET discord_role_id=NULL WHERE id='east_las_vegas'").run();
  let plan = await loadDiscordPlan(f.db, f.input);
  assert.ok(plan);
  assert.ok(plan.managedRoleIds.includes(eastRole));
  assert.deepEqual(plan.desiredRoleIds, [memberRoleId]);
  await f.people.withdrawConsent(f.person.id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: new Date().toISOString(),
  });
  plan = await loadDiscordPlan(f.db, f.input);
  assert.ok(plan);
  assert.deepEqual(plan.desiredRoleIds, []);
  f.db.raw
    .prepare(
      "UPDATE identities SET link_method='verified_email' WHERE person_id=? AND platform='discord'",
    )
    .run(f.person.id);
  assert.equal(await loadDiscordPlan(f.db, f.input), null);
});
