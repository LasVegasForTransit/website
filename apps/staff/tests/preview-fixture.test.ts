import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { linkWorkspaceIdentity } from '@lasvegasfortransit/platform-storage/workspace-link';
import { bootstrapStaffAdmin, loadActor } from '@lasvegasfortransit/platform-storage/staff-roles';
import {
  getStaffPerson,
  searchStaffPeople,
} from '@lasvegasfortransit/platform-storage/staff-people';

void test('the documented preview fixture supports administrator setup, profiles and roster pagination', async () => {
  const guide = await readFile(
    new URL('../../../docs/guides/set-up-staff-preview.md', import.meta.url),
    'utf8',
  );
  const sql = /```sql\n([\s\S]*?)\n```/.exec(guide)?.[1];
  assert.ok(sql, 'the setup guide must contain its reviewed preview fixture');
  const db = memoryDb();
  try {
    db.raw.exec(sql);
    const person = db.raw
      .prepare(
        "SELECT id,given_name,membership_status FROM people WHERE email='tester@example.invalid'",
      )
      .get() as { id: string; given_name: string; membership_status: string };
    assert.ok(person);
    assert.equal(person.given_name, 'PREVIEW TEST');
    assert.equal(person.membership_status, 'member');
    await linkWorkspaceIdentity(db, {
      workspace: {
        subject: 'preview-tester-google',
        email: 'tester@lasvegasfortransit.org',
        givenName: null,
        familyName: null,
      },
      personId: person.id,
      method: 'self_linked',
      operationId: 'preview-fixture-link',
    });
    assert.equal(
      (
        await bootstrapStaffAdmin(db, {
          presidentPersonId: person.id,
          workspaceSubject: 'preview-tester-google',
          performedBy: 'preview-fixture-maintainer',
          operationId: 'preview-fixture-bootstrap',
        })
      ).kind,
      'ok',
    );
    const actor = await loadActor(db, person.id);
    assert.ok(actor);
    assert.equal((await getStaffPerson(db, actor, person.id))?.person.id, person.id);
    const second = await new PersonService(db).upsertFromSource({
      source: 'join_form',
      fields: { given_name: 'Z PREVIEW TEST', email: 'second@example.invalid' },
      consent: {
        scope: 'newsletter',
        source: 'import',
        method: 'unknown',
        wordingVersion: 'preview-test-only',
      },
    });
    const firstPage = await searchStaffPeople(db, actor, { limit: 1 });
    assert.equal(firstPage.items[0]?.id, person.id);
    assert.ok(firstPage.nextCursor);
    const nextPage = await searchStaffPeople(db, actor, {
      limit: 1,
      cursor: firstPage.nextCursor,
    });
    assert.equal(nextPage.items[0]?.id, second.person.id);
    assert.throws(() => db.raw.exec(sql), /UNIQUE constraint failed/);
  } finally {
    db.raw.close();
  }
});
