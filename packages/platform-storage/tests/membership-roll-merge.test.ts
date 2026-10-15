import assert from 'node:assert/strict';
import test from 'node:test';
import { recordCurrentMembershipRoll } from '../src/membership-roll';
import { mergeFixture } from './support/merge-fixture';

async function rollMergeFixture(options: { rollOn: 'survivor' | 'merged'; consent: boolean }) {
  const f = await mergeFixture(undefined, '2026-01-01T12:00:00.000Z');
  const member = f[options.rollOn];
  const leaving = f[options.rollOn === 'survivor' ? 'merged' : 'survivor'];
  if (!options.consent)
    f.db.raw
      .prepare("DELETE FROM consent_records WHERE person_id=? AND scope='newsletter'")
      .run(member.id);
  if (!member.email) {
    await f.people.updateFields(leaving.id, {
      source: 'staff',
      fields: { email: null },
      allowClear: true,
    });
    await f.people.updateFields(member.id, {
      source: 'staff',
      fields: { email: 'merge-roll@example.invalid' },
    });
  }
  const person = await f.people.getExactPerson(member.id);
  assert.ok(person?.email);
  await f.people.linkIdentity(member.id, {
    platform: 'beehiiv',
    externalId: 'sub_merge_roll',
    externalEmail: person.email,
    linkMethod: 'created_by_platform',
  });
  assert.equal(
    await recordCurrentMembershipRoll(f.db, {
      personId: member.id,
      externalId: 'sub_merge_roll',
      status: 'active',
      observedAt: '2026-10-14T10:00:00.000Z',
    }),
    'applied',
  );
  await f.people.withdrawConsent(leaving.id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: '2026-10-13T12:00:00.000Z',
  });
  const before = f.db.raw.prepare('SELECT * FROM membership_roll').get();
  const combined = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(combined.kind, 'ok');
  assert.equal((await f.people.getExactPerson(f.survivor.id))?.membership_status, 'former_member');
  assert.equal(
    f.db.raw.prepare('SELECT entitled FROM membership_roll').get()?.entitled,
    1,
    'combining existing choices must not revoke the original independent roll',
  );
  const undo = async () => {
    const result = await f.undoMerge(f.db, f.actor, {
      mergeId: combined.value.mergeId,
      operationId: 'undo-roll',
      reason: 'These are separate people.',
    });
    assert.equal(result.kind, 'ok');
  };
  return { ...f, member, leaving, before, undo };
}

for (const options of [
  { rollOn: 'survivor', consent: false },
  { rollOn: 'survivor', consent: true },
  { rollOn: 'merged', consent: false },
] as const)
  void test(`undo restores the ${options.rollOn}'s roll after ${options.consent ? 'consent suppression' : 'withdrawal ownership moves'}`, async (context) => {
    const f = await rollMergeFixture(options);
    context.after(() => f.db.raw.close());
    await f.undo();
    assert.deepEqual(f.db.raw.prepare('SELECT * FROM membership_roll').get(), f.before);
    assert.equal((await f.people.getExactPerson(f.member.id))?.membership_status, 'member');
    assert.equal((await f.people.getExactPerson(f.leaving.id))?.membership_status, 'former_member');
  });

for (const rollOn of ['survivor', 'merged'] as const)
  void test(`an actual opt-out after the combination remains authoritative for the ${rollOn} after undo`, async (context) => {
    const f = await rollMergeFixture({ rollOn, consent: false });
    context.after(() => f.db.raw.close());
    const actual = '2026-10-14T11:00:00.000Z';
    await f.people.withdrawConsent(f.survivor.id, {
      scope: 'newsletter',
      source: 'account',
      withdrawnAt: actual,
    });
    await f.undo();
    const roll = f.db.raw
      .prepare('SELECT person_id,entitled,revoked_at FROM membership_roll')
      .get();
    assert.deepEqual({ ...roll }, { person_id: f.member.id, entitled: 0, revoked_at: actual });
    assert.equal((await f.people.getExactPerson(f.member.id))?.membership_status, 'former_member');
    assert.equal((await f.people.getExactPerson(f.leaving.id))?.membership_status, 'former_member');
  });
