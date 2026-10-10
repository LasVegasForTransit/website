import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb, everyStoredText } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { DiscordLinkService } from '@lasvegasfortransit/platform-storage/discord-link';
import { createSession } from '@lasvegasfortransit/platform-storage/auth';
import { exportData } from '../platform/account-data';
void test('a member can download their verified Discord profile and deletion clears its personal fields', async () => {
  const db = memoryDb(),
    people = new PersonService(db);
  const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-session-only' };
  const service = new DiscordLinkService(env),
    origin = 'https://lasvegasfortransit.org';
  const ids: string[] = [];
  for (const [id, username] of [
    ['222222222222222222', 'member-owned-profile'],
    ['333333333333333333', 'other-owned-profile'],
  ]) {
    assert.ok(id && username);
    const { person } = await people.upsertFromSource({
      source: 'join_form',
      fields: { email: `member-${id}@example.invalid` },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    });
    ids.push(person.id);
    const session = await createSession(env, person.id, 'member');
    const started = await service.begin({ sessionToken: session.token, origin });
    assert.ok(started);
    const claim = await service.claim({
      state: started.state,
      sessionToken: session.token,
      origin,
    });
    assert.ok(claim);
    assert.equal(
      await service.complete({
        claim,
        identity: { id, username, displayName: username, avatar: null },
      }),
      true,
    );
  }
  const personId = ids[0];
  assert.ok(personId);
  const data = await exportData(db, personId);
  assert.ok(data);
  assert.equal(JSON.stringify(data).includes('member-owned-profile'), true);
  assert.equal(JSON.stringify(data).includes('other-owned-profile'), false);
  await people.deletePerson(personId);
  assert.equal(
    (await db.prepare('SELECT count(*) AS count FROM discord_identity_profiles').first())?.count,
    1,
  );
  assert.equal(everyStoredText(db).includes('member-owned-profile'), false);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT count(*) AS count FROM identities WHERE person_id=? AND platform='discord'",
        )
        .bind(personId)
        .first()
    )?.count,
    1,
    'stable account ID remains available for role removal',
  );
});
