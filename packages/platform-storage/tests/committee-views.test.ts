import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFixture } from './support/merge-fixture';
import { loadActor } from '../src/staff-roles';
void test('committee directory and rosters enforce current scope, counts and deleted exclusion', async () => {
  const { db, admin, actor, survivor, merged, committees, create } = await mergeFixture();
  const views = await import('../src/committee-views').catch(() => null);
  assert.ok(views, 'staff need authorized committee rosters');
  try {
    await committees.assign({
      personId: survivor.id,
      committeeId: 'events',
      role: 'lead',
      actorId: admin.id,
      operationId: 'lead',
    });
    const ended = await committees.assign({
      personId: merged.id,
      committeeId: 'events',
      role: 'member',
      actorId: admin.id,
      operationId: 'member',
    });
    assert.equal(ended.kind, 'ok');
    await committees.endAssignment(ended.value.id, 'stepped_back', admin.id, 'end');
    const deleted = await create('deleted@example.invalid', 'Deleted');
    await committees.assign({
      personId: deleted.id,
      committeeId: 'events',
      role: 'member',
      actorId: admin.id,
      operationId: 'deleted',
    });
    db.raw
      .prepare('UPDATE people SET deleted_at=? WHERE id=?')
      .run(new Date().toISOString(), deleted.id);
    const all = await views.listCommittees(db, actor);
    assert.equal(all.length, 9);
    assert.equal(all.find((item) => item.id === 'events')?.peopleCount, 1);
    assert.deepEqual(all.find((item) => item.id === 'events')?.leadNames, ['Survivor']);
    const lead = await loadActor(db, survivor.id);
    assert.ok(lead);
    assert.deepEqual(
      (await views.listCommittees(db, lead)).map((item) => item.id),
      ['events'],
    );
    assert.equal(await views.getCommitteeView(db, lead, 'advocacy'), null);
    const roster = await views.getCommitteeView(db, actor, 'events');
    assert.ok(roster);
    assert.deepEqual(
      roster.current.items.map((item) => item.personId),
      [survivor.id],
    );
    assert.deepEqual(
      roster.past.items.map((item) => item.personId),
      [merged.id],
    );
    assert.equal((await views.getCommitteeView(db, lead, 'events'))?.past.items.length, 0);
    db.raw
      .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
      .run(survivor.id);
    assert.deepEqual(await views.listCommittees(db, lead), []);
    assert.equal(await views.getCommitteeView(db, lead, 'events'), null);
    assert.deepEqual(
      (await views.listCommittees(db, actor)).find((item) => item.id === 'events')?.leadNames,
      [],
    );
  } finally {
    db.raw.close();
  }
});
void test('committee rosters paginate without exposing another committee or archived people', async () => {
  const { db, admin, actor, committees, create } = await mergeFixture();
  const views = await import('../src/committee-views').catch(() => null);
  assert.ok(views);
  try {
    for (let i = 0; i < 4; i++) {
      const person = await create(`rider-${i}@example.invalid`, `Rider ${i}`);
      await committees.assign({
        personId: person.id,
        committeeId: i === 3 ? 'advocacy' : 'events',
        role: 'member',
        actorId: admin.id,
        operationId: `assign-${i}`,
      });
    }
    const first = await views.getCommitteeView(db, actor, 'events', { limit: 2 });
    assert.ok(first?.current.nextCursor);
    const second = await views.getCommitteeView(db, actor, 'events', {
      limit: 2,
      cursor: first.current.nextCursor,
    });
    assert.equal(second?.current.items.length, 1);
    assert.equal(second.current.nextCursor, null);
    assert.equal(
      new Set([...first.current.items, ...second.current.items].map((item) => item.personId)).size,
      3,
    );
  } finally {
    db.raw.close();
  }
});
