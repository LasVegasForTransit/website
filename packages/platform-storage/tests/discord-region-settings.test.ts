import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFixture } from './support/merge-fixture';

void test('region mappings require current administrator authority and preserve retired owners and an attributed replayable receipt', async (context) => {
  const module = await import('../src/discord-region-settings').catch(() => null);
  assert.ok(module, 'region mappings need current authenticated administrator storage');
  const f = await mergeFixture();
  context.after(() => f.db.raw.close());
  const input = {
    regionId: 'east_las_vegas',
    roleId: '444444444444444444',
    expectedVersion: 1,
    operationId: 'east-region',
  };
  assert.equal(
    (await module.saveDiscordRegionSettings(f.db, { ...f.actor, personId: f.survivor.id }, input))
      .kind,
    'forbidden',
  );
  const saved = await module.saveDiscordRegionSettings(f.db, f.actor, input);
  assert.equal(saved.kind, 'ok');
  assert.deepEqual(await module.saveDiscordRegionSettings(f.db, f.actor, input), saved);
  assert.equal(
    (
      await module.saveDiscordRegionSettings(f.db, f.actor, {
        ...input,
        regionId: 'summerlin',
        operationId: 'role-reused',
      })
    ).kind,
    'conflict',
  );
  assert.equal(
    (
      await module.saveDiscordRegionSettings(f.db, f.actor, {
        ...input,
        roleId: null,
        expectedVersion: 2,
        operationId: 'east-unset',
      })
    ).kind,
    'ok',
  );
  assert.equal(
    f.db.raw.prepare('SELECT external_id FROM discord_region_role_mappings').get()?.external_id,
    input.roleId,
  );
  assert.equal(
    f.db.raw
      .prepare(
        "SELECT actor_id FROM staff_audits WHERE action='discord.region.settings' ORDER BY occurred_at DESC LIMIT 1",
      )
      .get()?.actor_id,
    f.actor.personId,
  );
  f.db.raw
    .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
    .run(f.actor.personId);
  assert.equal(
    (
      await module.saveDiscordRegionSettings(f.db, f.actor, {
        ...input,
        expectedVersion: 3,
        operationId: 'stale-admin',
      })
    ).kind,
    'forbidden',
  );
});
