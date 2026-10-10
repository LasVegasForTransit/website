import assert from 'node:assert/strict';
import { PersonService } from '../../src/person-service';
import { CommitteeService } from '../../src/committees';
import { bootstrapStaffAdmin, loadActor } from '../../src/staff-roles';
import { linkWorkspaceIdentity } from '../../src/workspace-link';
import { memoryDb } from './db';
export async function mergeFixture(through?: string) {
  const loaded = await import('../../src/merges').catch(() => null);
  assert.ok(loaded, 'merge and undo must preserve exact movements and later work');
  const db = memoryDb(through);
  const people = new PersonService(db);
  const create = async (email: string, name: string) =>
    (
      await people.upsertFromSource({
        source: 'join_form',
        fields: { email, given_name: name },
        consent: {
          scope: 'newsletter',
          source: 'join_form',
          method: 'checkbox',
          wordingVersion: 'fixture',
        },
      })
    ).person;
  const admin = await create('admin@example.invalid', 'Administrator');
  const survivor = await create('survivor@example.invalid', 'Survivor');
  const merged = (
    await people.upsertFromSource({
      source: 'paper',
      fields: { given_name: 'Other entry', phone: '+17025550100' },
      consent: {
        scope: 'newsletter',
        source: 'paper',
        method: 'paper_signature',
        wordingVersion: 'fixture',
      },
    })
  ).person;
  await linkWorkspaceIdentity(db, {
    workspace: {
      subject: 'fixture-admin',
      email: 'admin@lasvegasfortransit.org',
      givenName: null,
      familyName: null,
    },
    personId: admin.id,
    method: 'self_linked',
    operationId: 'admin-link',
  });
  await bootstrapStaffAdmin(db, {
    presidentPersonId: admin.id,
    workspaceSubject: 'fixture-admin',
    performedBy: 'fixture',
    operationId: 'bootstrap',
  });
  const actor = await loadActor(db, admin.id);
  assert.ok(actor);
  const committees = new CommitteeService(db);
  const input = {
    survivorId: survivor.id,
    mergedId: merged.id,
    reason: 'Confirmed by the member.',
    operationId: 'combine',
  };
  return { ...loaded, db, people, create, actor, admin, survivor, merged, committees, input };
}
