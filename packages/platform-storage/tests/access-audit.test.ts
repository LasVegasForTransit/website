import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFixture } from './support/merge-fixture';
import { loadActor } from '../src/staff-roles';
import { PermissionDenied } from '@lasvegasfortransit/platform-core/permissions';

async function fixture() {
  const api = await import('../src/access-audit').catch(() => null);
  assert.ok(api, 'all access systems need one confirmed-change writer and administrator history');
  return { ...(await mergeFixture()), ...api };
}
void test('shared access history records supported systems once and omits unchanged grants', async () => {
  const f = await fixture();
  try {
    const at = new Date('2026-10-14T12:00:00.000Z');
    for (const [system, action] of [
      ['google_workspace', 'suspend'],
      ['google_group', 'grant'],
      ['discord', 'revoke'],
      ['github', 'transfer'],
      ['checklist', 'delete'],
      ['google_workspace', 'unsuspend'],
    ] as const) {
      const input = {
        personId: f.survivor.id,
        system,
        action,
        target: 'managed-resource',
        actor: f.admin.id,
        reason: 'staff_correction' as const,
        operationId: `${system}-${action}`,
        changed: true,
      };
      await f.accessChangeWrite(f.db, { change: input }, at).run();
      await f.accessChangeWrite(f.db, { change: input }, at).run();
    }
    await f
      .accessChangeWrite(
        f.db,
        {
          change: {
            personId: f.survivor.id,
            system: 'discord',
            action: 'grant',
            target: 'unchanged-role',
            actor: 'platform',
            reason: 'periodic_check',
            operationId: 'unchanged',
            changed: false,
          },
        },
        at,
      )
      .run();
    const page = await f.listAccessChanges(f.db, f.actor, { personId: f.survivor.id, now: at });
    assert.equal(page.items.length, 6);
    assert.deepEqual(
      new Set(page.items.map((r) => r.system)),
      new Set(['google_workspace', 'google_group', 'discord', 'github', 'checklist']),
    );
    assert.equal(
      page.items.some((r) => r.target === 'unchanged-role'),
      false,
    );
    assert.ok(page.items.every((r) => r.actor === f.admin.id && r.reason === 'staff_correction'));
    assert.ok(page.items.every((r) => r.personId === f.survivor.id));
  } finally {
    f.db.raw.close();
  }
});
void test('normalized access history is administrator-only and retains anonymized erasure evidence', async () => {
  const f = await fixture();
  try {
    const at = new Date();
    await f
      .accessChangeWrite(
        f.db,
        {
          change: {
            personId: f.survivor.id,
            system: 'discord',
            action: 'revoke',
            target: 'managed-role',
            actor: 'platform',
            reason: 'person_deleted',
            operationId: 'erase-proof',
            changed: true,
          },
        },
        at,
      )
      .run();
    const lead = await f.create('review-lead@example.invalid', 'Lead');
    await f.committees.assign({
      personId: lead.id,
      committeeId: 'events',
      role: 'lead',
      actorId: f.admin.id,
      operationId: 'lead',
    });
    const actor = await loadActor(f.db, lead.id);
    assert.ok(actor);
    await assert.rejects(f.listAccessChanges(f.db, actor, { now: at }), PermissionDenied);
    await f.people.deletePerson(f.survivor.id);
    const page = await f.listAccessChanges(f.db, f.actor, {
      personId: f.survivor.id,
      now: new Date(),
    });
    assert.equal(page.items.length, 1);
    assert.ok(page.items[0]);
    assert.equal(page.items[0].personDeleted, true);
    assert.equal(page.items[0].system, null);
    assert.equal(page.items[0].target, null);
    assert.equal(page.items[0].actor, 'platform');
    assert.equal(page.items[0].action, 'revoke');
  } finally {
    f.db.raw.close();
  }
});
void test('Discord corrections include only the requested seven days and paginate without changing the filter', async () => {
  const f = await fixture();
  try {
    const now = new Date('2026-10-14T12:00:00.000Z');
    for (const [id, system, at] of [
      ['old', 'discord', '2026-10-07T11:59:59.999Z'],
      ['at', 'discord', '2026-10-07T12:00:00.000Z'],
      ['new', 'discord', '2026-10-14T11:00:00.000Z'],
      ['other', 'github', '2026-10-14T11:00:00.000Z'],
    ] as const)
      await f
        .accessChangeWrite(
          f.db,
          {
            change: {
              personId: f.survivor.id,
              system,
              action: 'grant',
              target: id,
              actor: 'platform',
              reason: 'periodic_check',
              operationId: id,
              changed: true,
            },
          },
          new Date(at),
        )
        .run();
    const query = {
      system: 'discord' as const,
      since: new Date('2026-10-07T12:00:00.000Z'),
      now,
      limit: 1,
    };
    const first = await f.listAccessChanges(f.db, f.actor, query);
    assert.equal(first.items[0]?.target, 'new');
    assert.ok(first.nextCursor);
    const second = await f.listAccessChanges(f.db, f.actor, { ...query, cursor: first.nextCursor });
    assert.equal(second.items[0]?.target, 'at');
    assert.equal(second.nextCursor, null);
  } finally {
    f.db.raw.close();
  }
});
