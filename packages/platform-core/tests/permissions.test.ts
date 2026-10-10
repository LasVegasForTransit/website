import assert from 'node:assert/strict';
import test from 'node:test';
async function permissions() {
  const loaded = await import('../src/permissions').catch(() => null);
  assert.ok(loaded, 'one permission matrix must protect staff data');
  return loaded;
}
void test('every staff permission cell allows its scope and denies unrelated records', async () => {
  const { can } = await permissions();
  const base = {
    personId: 'actor',
    membershipStatus: 'member' as const,
    workspaceLinked: false,
    staffAdmin: false,
    committees: [],
    eventsLed: [],
  };
  const member = base;
  const volunteer = { ...base, workspaceLinked: true };
  const lead = {
    ...volunteer,
    committees: [{ id: 'events', role: 'lead' as const, interestIds: ['events' as const] }],
    eventsLed: ['event-one'],
  };
  const admin = { ...volunteer, staffAdmin: true };
  for (const permission of ['self.view', 'self.update', 'self.export', 'self.delete'] as const) {
    for (const actor of [member, volunteer, lead, admin]) {
      assert.equal(can(actor, permission, { personId: 'actor' }), true);
      assert.equal(can(actor, permission, { personId: 'someone-else' }), false);
    }
  }
  const rules = [
    ['console.enter', [false, false, true, true]],
    ['access.view', [false, false, true, true]],
    ['access.recover', [false, false, false, true]],
    ['person.view', [false, false, true, true]],
    ['person.search', [false, false, true, true]],
    ['person.update', [false, false, false, true]],
    ['review_queue.resolve', [false, false, false, true]],
    ['person.merge', [false, false, false, true]],
    ['person.unmerge', [false, false, false, true]],
    ['committee.assign', [false, false, true, true]],
    ['committee.view', [false, false, true, true]],
    ['committee.settings', [false, false, false, true]],
    ['attendance.record', [false, true, true, true]],
    ['attendance.view_event', [false, false, true, true]],
    ['donations.view', [false, false, false, true]],
    ['export.full', [false, false, false, true]],
    ['announcement.send', [false, false, true, true]],
    ['staff_admin.manage', [false, false, false, true]],
  ] as const;
  const target = {
    personId: 'someone-else',
    committeeIds: ['events'],
    committeeId: 'events',
    eventId: 'event-one',
  };
  const outside = {
    ...target,
    committeeIds: ['advocacy'],
    committeeId: 'advocacy',
    eventId: 'event-two',
  };
  for (const [permission, allowed] of rules) {
    for (const [index, actor] of [member, volunteer, lead, admin].entries())
      assert.equal(can(actor, permission, target), allowed[index], `${permission} role ${index}`);
    if (
      [
        'person.view',
        'person.search',
        'committee.assign',
        'committee.view',
        'attendance.view_event',
        'announcement.send',
      ].includes(permission)
    )
      assert.equal(can(lead, permission, outside), false, `${permission} outside scope`);
  }
  assert.equal(
    can({ ...base, membershipStatus: 'not_member', workspaceLinked: true }, 'staff_admin.manage'),
    false,
  );
  assert.equal(can({ ...lead, committees: [] }, 'console.enter'), false);
});
void test('welcome interest access never grants full person access', async () => {
  const { can } = await permissions();
  const lead = {
    personId: 'actor',
    membershipStatus: 'member' as const,
    workspaceLinked: true,
    staffAdmin: false,
    committees: [{ id: 'events', role: 'lead' as const, interestIds: ['events' as const] }],
    eventsLed: [],
  };
  const interested = { personId: 'new-member', committeeIds: [], interestIds: ['events' as const] };
  for (const permission of ['welcome.view', 'welcome.claim', 'welcome.complete'] as const) {
    assert.equal(can(lead, permission, interested), true);
    assert.equal(can(lead, permission, { ...interested, interestIds: ['meetings'] }), false);
    assert.equal(can({ ...lead, committees: [] }, permission, interested), false);
  }
  assert.equal(can(lead, 'person.view', interested), false);
});
void test('permission denial uses one message and contains no hidden target data', async () => {
  const { requirePermission } = await permissions();
  const actor = {
    personId: 'actor',
    membershipStatus: 'member' as const,
    workspaceLinked: false,
    staffAdmin: false,
    committees: [],
    eventsLed: [],
  };
  assert.throws(() => requirePermission(actor, 'person.view', { personId: 'secret-person' }), {
    message: "You don't have access to this",
  });
});

void test('former members retain self-service but lose all staff permissions immediately', async () => {
  const { can, PERMISSION_SCOPES } = await permissions();
  const actor = {
    personId: 'actor',
    membershipStatus: 'former_member' as const,
    workspaceLinked: true,
    staffAdmin: true,
    committees: [{ id: 'events', role: 'lead' as const, interestIds: ['events' as const] }],
    eventsLed: ['event-one'],
  };
  for (const permission of Object.keys(PERMISSION_SCOPES) as (keyof typeof PERMISSION_SCOPES)[]) {
    assert.equal(
      can(actor, permission, {
        personId: 'actor',
        committeeId: 'events',
        committeeIds: ['events'],
        eventId: 'event-one',
        interestIds: ['events'],
      }),
      PERMISSION_SCOPES[permission] === 'self',
      permission,
    );
  }
});
