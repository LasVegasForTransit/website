import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { randomToken } from '@lasvegasfortransit/platform-core/random-token';
import { pollBeehiivRoster } from '../src/beehiiv-poll';
import { reconcileBeehiivPerson } from '../src/beehiiv-sync';

async function fixture() {
  const db = memoryDb();
  const { person } = await new PersonService(db).upsertFromSource({
    source: 'join_form',
    fields: { email: 'limited@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  const start = new Date(Date.now() + 1000);
  return {
    db,
    person,
    now: () => start,
    configuration: { publicationId: 'pub_shared_limit', apiKey: 'fixture-only' },
    intentKey: randomToken(),
  };
}
const limited = () =>
  Promise.resolve(new Response(null, { status: 429, headers: { 'Retry-After': '1.25' } }));
void test('a roster rate limit also pauses queued subscription work after a new dispatcher starts', async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await pollBeehiivRoster(f.db, f.configuration, { now: f.now, fetcher: limited })).kind,
      'retry',
    );
    let requests = 0;
    const result = await reconcileBeehiivPerson(f.db, f.person.id, {
      configuration: f.configuration,
      intentKey: f.intentKey,
      now: f.now,
      fetcher: () => {
        requests++;
        return Promise.reject(new Error('provider remains paused'));
      },
    });
    assert.equal(result.kind, 'retry');
    assert.equal(requests, 0);
    assert.equal(
      (await new PersonService(f.db).getPerson(f.person.id))?.membership_status,
      'member',
    );
  } finally {
    f.db.raw.close();
  }
});
void test('a subscription rate limit also pauses the next roster poll', async () => {
  const f = await fixture();
  try {
    assert.equal(
      (
        await reconcileBeehiivPerson(f.db, f.person.id, {
          configuration: f.configuration,
          intentKey: f.intentKey,
          now: f.now,
          fetcher: limited,
        })
      ).kind,
      'retry',
    );
    let requests = 0;
    const result = await pollBeehiivRoster(f.db, f.configuration, {
      now: f.now,
      fetcher: () => {
        requests++;
        return Promise.reject(new Error('provider remains paused'));
      },
    });
    assert.equal(result.kind, 'idle');
    assert.equal(requests, 0);
  } finally {
    f.db.raw.close();
  }
});
