import assert from 'node:assert/strict';
import test from 'node:test';
import { accessFixture as fixture } from './support/access-fixture';
import { enqueueOperation, markOperationFailed } from '../src/outbox';

void test('retry lists omit confirmed access while keeping complete pages of unresolved members', async () => {
  const f = await fixture();
  try {
    const records = [];
    for (const index of Array.from({ length: 103 }, (_, index) => index)) {
      const { person } = await f.people.upsertFromSource({
        source: 'join_form',
        fields: { given_name: `Access ${index}`, email: `access-${index}@example.invalid` },
        consent: {
          scope: 'newsletter',
          source: 'join_form',
          method: 'checkbox',
          wordingVersion: 'fixture',
        },
      });
      records.push(person);
      await f.people.linkIdentity(person.id, {
        platform: 'discord',
        externalId: `access-${index}`,
        linkMethod: 'self_linked',
      });
      await f.db
        .prepare(
          "INSERT INTO reconcile_generations(person_id,target_id,generation) VALUES(?,'person',1)",
        )
        .bind(person.id)
        .run();
      const operation = { id: `access-retry-${index}`, generation: 1 };
      await enqueueOperation(f.db, {
        id: operation.id,
        personId: person.id,
        targetId: 'person',
        kind: 'person_reconcile',
        generation: operation.generation,
        payload: {},
      });
      await markOperationFailed(f.db, operation.id, 'provider_unavailable');
      if (index < 101)
        assert.equal(
          await f.recordAccessObservation(f.db, {
            ...f.observation,
            personId: person.id,
            targetId: 'person',
            identityId: `access-${index}`,
            resourceId: '789',
            generation: operation.generation,
          }),
          true,
        );
    }
    const pendingIds = records
      .slice(101)
      .map((person) => person.id)
      .sort();
    const first = await f.listAccess(f.db, f.actor, {
      needsAttention: true,
      configuration: f.configuration,
      text: 'access-',
      limit: 1,
    });
    assert.deepEqual(
      first.items.map((row) => row.personId),
      pendingIds.slice(0, 1),
    );
    assert.ok(first.nextCursor);
    const second = await f.listAccess(f.db, f.actor, {
      needsAttention: true,
      configuration: f.configuration,
      text: 'access-',
      limit: 1,
      cursor: first.nextCursor,
    });
    assert.deepEqual(
      second.items.map((row) => row.personId),
      pendingIds.slice(1),
    );
    assert.equal(second.nextCursor, null);
    const resolved = await f.listAccess(f.db, f.actor, {
      needsAttention: true,
      configuration: f.configuration,
      text: 'access-0@',
      limit: 1,
    });
    assert.deepEqual(resolved.items, []);
    assert.equal(resolved.nextCursor, null);
  } finally {
    f.db.raw.close();
  }
});
