import assert from 'node:assert/strict';
import test from 'node:test';

void test('new account sections sort by position without changing their registrations', async () => {
  const loaded = await import('../platform/account-sections').catch(() => null);
  assert.ok(loaded, 'the account needs an ordered section registration');
  const sections = [
    { id: 'data', position: 90 },
    { id: 'details', position: 20 },
    { id: 'mailing-list', position: 30 },
    { id: 'membership', position: 10 },
    { id: 'test-section', position: 40 },
    { id: 'discord', position: 60 },
  ];
  assert.deepEqual(
    loaded.orderAccountSections(sections).map((section) => section.id),
    ['membership', 'details', 'mailing-list', 'test-section', 'discord', 'data'],
  );
  assert.equal(sections[0]?.id, 'data', 'ordering does not mutate the registrations');
});
