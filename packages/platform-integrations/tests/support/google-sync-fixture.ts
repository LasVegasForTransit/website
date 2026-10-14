import assert from 'node:assert/strict';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { enqueueOperation } from '@lasvegasfortransit/platform-storage/outbox';
import { GoogleGroups } from '../../src/google-groups';
import { configuration, directory, groupEmail, userId, userEmail } from './google-directory';
export async function fixture() {
  const loaded = await import('../../src/google-sync').catch(() => null);
  assert.ok(
    loaded,
    'Google reconciliation must save guarded observations and provider-specific receipts',
  );
  const db = memoryDb();
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'member@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  await people.linkIdentity(person.id, {
    platform: 'google_workspace',
    externalId: userId,
    externalEmail: userEmail,
    linkMethod: 'self_linked',
  });
  const stamp = new Date().toISOString();
  await db
    .prepare("UPDATE committees SET workspace_group_email=? WHERE id='events'")
    .bind(groupEmail)
    .run();
  await db
    .prepare(
      "INSERT INTO committee_assignments(id,person_id,committee_id,role,started_at,assigned_by,updated_at) VALUES('google-assignment',?,'events','member',?,?,?)",
    )
    .bind(person.id, stamp, person.id, stamp)
    .run();
  await db
    .prepare(
      "INSERT INTO reconcile_generations(person_id,target_id,generation) VALUES(?,'person',1)",
    )
    .bind(person.id)
    .run();
  await enqueueOperation(db, {
    id: 'google-fixture',
    kind: 'person_reconcile',
    personId: person.id,
    targetId: 'person',
    generation: 1,
    payload: {},
  });
  const remote = directory();
  return {
    ...loaded,
    db,
    people,
    person,
    remote,
    client: new GoogleGroups(configuration, remote.tokens, { fetch: remote.fetch }),
  };
}
