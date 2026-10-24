import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { PersonService } from '../../src/person-service';
import { CommitteeService } from '../../src/committees';
import { bootstrapStaffAdmin, loadActor } from '../../src/staff-roles';
import { linkWorkspaceIdentity } from '../../src/workspace-link';
import { memoryDb } from './db';
export async function mergeFixture(through?: string, initialConsentAt?: string) {
  const loaded = await import('../../src/merges').catch(() => null);
  assert.ok(loaded, 'merge and undo must preserve exact movements and later work');
  const db = memoryDb(through);
  // Current merge code includes SSO links. Install only that independent schema
  // when a regression deliberately leaves an unrelated migration pending.
  if (through && through < '0055_staff_sso.sql') {
    db.raw.exec(
      readFileSync(new URL('../../migrations/0055_staff_sso.sql', import.meta.url), 'utf8'),
    );
    db.raw.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run('0055_staff_sso.sql');
  }
  if (through && through < '0056_staff_accounts.sql') {
    db.raw.exec(
      readFileSync(new URL('../../migrations/0056_staff_accounts.sql', import.meta.url), 'utf8'),
    );
    db.raw.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run('0056_staff_accounts.sql');
  }
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
          ...(initialConsentAt ? { givenAt: initialConsentAt } : {}),
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
        ...(initialConsentAt ? { givenAt: initialConsentAt } : {}),
      },
    })
  ).person;
  db.raw
    .prepare('UPDATE people SET created_at=? WHERE id=?')
    .run(
      new Date(
        Math.max(Date.parse(merged.created_at), Date.parse(survivor.created_at) + 1),
      ).toISOString(),
      merged.id,
    );
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
