import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonService } from '../src/person-service';
import { memoryDb } from './support/db';
void test('generic identity linking reports a competing owner instead of silently succeeding', async () => {
  const db = memoryDb();
  const people = new PersonService(db);
  const first = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'ana@example.org' },
  });
  const second = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'bo@example.org' },
  });
  const input = {
    platform: 'google_workspace' as const,
    externalId: 'stable-subject',
    linkMethod: 'self_linked' as const,
  };
  assert.deepEqual(await people.linkIdentity(first.person.id, input), {
    kind: 'ok',
    personId: first.person.id,
  });
  assert.deepEqual(await people.linkIdentity(first.person.id, input), {
    kind: 'ok',
    personId: first.person.id,
  });
  assert.deepEqual(await people.linkIdentity(second.person.id, input), { kind: 'conflict' });
  assert.equal(
    db.raw.prepare('SELECT person_id FROM identities').get()?.person_id,
    first.person.id,
  );
  db.raw.close();
});
void test('generic identity linking cannot revive a deleted person', async () => {
  const db = memoryDb();
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'ana@example.org' },
  });
  db.raw.prepare('UPDATE people SET deleted_at = ? WHERE id = ?').run('2026-10-04', person.id);
  assert.deepEqual(
    await people.linkIdentity(person.id, {
      platform: 'discord',
      externalId: 'discord-id',
      linkMethod: 'self_linked',
    }),
    { kind: 'not_found' },
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM identities').get()?.n, 0);
  db.raw.close();
});
