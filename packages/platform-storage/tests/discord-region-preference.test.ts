import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { PersonService } from '../src/person-service';
import { createSession, endSession } from '../src/auth';

void test('region sharing defaults on and saves only for the current exact authenticated person', async (context) => {
  const module = await import('../src/discord-region').catch(() => null);
  assert.ok(module, 'region visibility must be governed by the current member session');
  const db = memoryDb();
  context.after(() => db.raw.close());
  const people = new PersonService(db),
    env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'region-fixture-secret' };
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'sharing@example.invalid' },
  });
  const { person: other } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'other@example.invalid' },
  });
  const session = await createSession(env, person.id, 'member');
  assert.equal(await module.discordRegionVisibility(env, session.token), true);
  assert.equal(
    await module.saveDiscordRegionVisibility(env, {
      sessionToken: session.token,
      personId: other.id,
      visible: false,
    }),
    false,
  );
  assert.equal(
    await module.saveDiscordRegionVisibility(env, {
      sessionToken: session.token,
      personId: person.id,
      visible: false,
    }),
    true,
  );
  assert.equal(await module.discordRegionVisibility(env, session.token), false);
  await endSession(env, session.token);
  assert.equal(
    await module.saveDiscordRegionVisibility(env, {
      sessionToken: session.token,
      personId: person.id,
      visible: true,
    }),
    false,
  );
  assert.equal(await module.discordRegionVisibility(env, session.token), null);
  assert.equal(
    db.raw.prepare('SELECT discord_region_visible FROM people WHERE id=?').get(person.id)
      ?.discord_region_visible,
    0,
  );
});
