import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { pendingDiscordOperations } from '@lasvegasfortransit/platform-storage/discord-pending';
import { DiscordAccess } from '../src/discord-access';
import { syncDiscordOperation } from '../src/discord-sync';
function address(input: Parameters<typeof fetch>[0]): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
const guildId = '111111111111111111',
  identityId = '222222222222222222',
  memberRole = '333333333333333333',
  eastRole = '444444444444444444',
  westRole = '555555555555555555',
  unmanaged = '666666666666666666';
void test('region reconciliation removes the former area before adding the new one, preserves unrelated roles, and logs provider proof', async (context) => {
  const db = memoryDb();
  context.after(() => db.raw.close());
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'region-sync@example.invalid' },
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
  db.raw.prepare('UPDATE regions SET discord_role_id=? WHERE id=?').run(eastRole, 'east_las_vegas');
  db.raw.prepare('UPDATE regions SET discord_role_id=? WHERE id=?').run(westRole, 'summerlin');
  await people.setRegion(person.id, 'summerlin', 'member_choice');
  const roles = new Set([memberRole, eastRole, unmanaged]),
    changes: string[] = [];
  const client = new DiscordAccess(
    {
      environment: 'preview',
      guildId,
      productionGuildId: '999999999999999999',
      botToken: 'fixture-only',
    },
    {
      fetch: (input, init) => {
        const roleId = address(input).split('/').at(-1) ?? '';
        if (init?.method === 'DELETE' || init?.method === 'PUT') {
          changes.push(`${init.method}:${roleId}`);
          if (init.method === 'DELETE') roles.delete(roleId);
          else roles.add(roleId);
          assert.ok(
            [...roles].filter((r) => r === eastRole || r === westRole).length <= 1,
            'a region swap must never temporarily share two areas',
          );
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(
          Response.json({
            user: { id: identityId, username: 'neighbor', global_name: null, avatar: null },
            roles: [...roles],
            pending: false,
            nick: null,
          }),
        );
      },
    },
  );
  const operation = (await pendingDiscordOperations(db, new Date(), 1))[0];
  assert.ok(operation);
  assert.deepEqual(
    await syncDiscordOperation(db, operation, { client, memberRoleId: memberRole }),
    { kind: 'confirmed' },
  );
  assert.deepEqual(changes, [`DELETE:${eastRole}`, `PUT:${westRole}`]);
  assert.ok(roles.has(unmanaged));
  const observations = db.raw
    .prepare(
      "SELECT target_id,state FROM access_observations WHERE target_id LIKE 'region:%' ORDER BY target_id",
    )
    .all();
  assert.deepEqual(
    observations.map((r) => ({ ...r })),
    [
      { target_id: 'region:east_las_vegas', state: 'absent' },
      { target_id: 'region:summerlin', state: 'granted' },
    ],
  );
  assert.equal(
    db.raw
      .prepare(
        "SELECT count(*) AS n FROM staff_audits WHERE action IN ('access.granted','access.revoked') AND json_extract(details,'$.targetId') LIKE 'region:%'",
      )
      .get()?.n,
    2,
  );
});
