import assert from 'node:assert/strict';
import test from 'node:test';
import { signToken } from '@lasvegasfortransit/platform-core/signing';
import { mergeFixture } from '../../../packages/platform-storage/tests/support/merge-fixture';
import { checkRemovalToken, removeEmail } from '../platform/remove';
import { accountView } from '../platform/account';
import type { Db } from '@lasvegasfortransit/platform-storage/db';

void test('a merge immediately before erasure refuses the expired exact subject without deleting the survivor', async (context) => {
  const f = await mergeFixture();
  context.after(() => f.db.raw.close());
  const secret = 'merge-erasure-race-fixture';
  await f.people.updateFields(f.survivor.id, {
    source: 'staff',
    fields: { email: null },
    allowClear: true,
  });
  await f.people.updateFields(f.merged.id, {
    source: 'staff',
    fields: { email: 'erasure-race@example.invalid' },
  });
  const token = await signToken(secret, {
    purpose: 'remove_email',
    subject: f.merged.id,
    expiresAt: Date.now() + 60_000,
  });
  let raced = false;
  const db: Db = {
    prepare: (sql) => f.db.prepare(sql),
    batch: async (statements) => {
      if (!raced && statements.length > 2) {
        raced = true;
        assert.equal((await f.mergePeople(f.db, f.actor, f.input)).kind, 'ok');
      }
      return f.db.batch(statements);
    },
  };
  assert.equal(
    await removeEmail({ PLATFORM_DB: db, LVBT_LINK_SIGNING_SECRET: secret }, token),
    'invalid',
  );
  assert.equal(raced, true);
  assert.equal(
    f.db.raw.prepare('SELECT erased_at FROM people WHERE id=?').get(f.survivor.id)?.erased_at,
    null,
  );
  assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM person_deletion_log').get()?.n, 0);
});

void test('a merge after the removal check cannot retarget its deletion transaction', async (context) => {
  const f = await mergeFixture();
  context.after(() => f.db.raw.close());
  const secret = 'merge-check-race-fixture';
  await f.people.updateFields(f.survivor.id, {
    source: 'staff',
    fields: { email: null },
    allowClear: true,
  });
  await f.people.updateFields(f.merged.id, {
    source: 'staff',
    fields: { email: 'race-mailbox@example.invalid' },
  });
  const token = await signToken(secret, {
    purpose: 'remove_email',
    subject: f.merged.id,
    expiresAt: Date.now() + 60_000,
  });
  let raced = false;
  const db: Db = {
    prepare: (sql) => f.db.prepare(sql),
    batch: async (statements) => {
      if (!raced) {
        raced = true;
        assert.equal((await f.mergePeople(f.db, f.actor, f.input)).kind, 'ok');
      }
      return f.db.batch(statements);
    },
  };
  assert.equal(
    await removeEmail({ PLATFORM_DB: db, LVBT_LINK_SIGNING_SECRET: secret }, token),
    'invalid',
  );
  assert.equal(raced, true);
  assert.equal(
    f.db.raw.prepare('SELECT erased_at FROM people WHERE id=?').get(f.survivor.id)?.erased_at,
    null,
  );
  assert.equal((await f.people.getPerson(f.survivor.id))?.membership_status, 'member');
});

void test('a removal link issued before a merge cannot reveal or erase the surviving member', async (context) => {
  const f = await mergeFixture();
  context.after(() => f.db.raw.close());
  const secret = 'merge-authority-fixture';
  await f.people.updateFields(f.survivor.id, {
    source: 'staff',
    fields: { email: null },
    allowClear: true,
  });
  await f.people.updateFields(f.merged.id, {
    source: 'staff',
    fields: { email: 'former-mailbox@example.invalid' },
  });
  const token = await signToken(secret, {
    purpose: 'remove_email',
    subject: f.merged.id,
    expiresAt: Date.now() + 60_000,
  });
  assert.equal((await f.mergePeople(f.db, f.actor, f.input)).kind, 'ok');
  await f.people.updateFields(f.survivor.id, {
    source: 'staff',
    fields: { email: 'survivor-private@example.invalid' },
  });
  const env = { PLATFORM_DB: f.db, LVBT_LINK_SIGNING_SECRET: secret };
  const before = f.db.raw.prepare('SELECT * FROM people ORDER BY id').all();
  assert.deepEqual(await checkRemovalToken(env, token), { kind: 'invalid' });
  assert.equal(await removeEmail(env, token), 'invalid');
  assert.deepEqual(f.db.raw.prepare('SELECT * FROM people ORDER BY id').all(), before);
  assert.equal(
    (await f.people.getPerson(f.merged.id))?.id,
    f.survivor.id,
    'ordinary old record links still resolve',
  );
});

void test('an account view is bound to its exact active session subject after a merge', async (context) => {
  const f = await mergeFixture();
  context.after(() => f.db.raw.close());
  assert.equal((await f.mergePeople(f.db, f.actor, f.input)).kind, 'ok');
  assert.equal(await accountView(f.db, f.merged.id), null);
  assert.equal((await accountView(f.db, f.survivor.id))?.person.id, f.survivor.id);
});
