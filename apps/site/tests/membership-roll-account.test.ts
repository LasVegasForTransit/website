import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { recordCurrentMembershipRoll } from '@lasvegasfortransit/platform-storage/membership-roll';
import { accountView, leaveMailingList } from '../platform/account';

void test('an existing member sees current mailing-list membership with no invented joining date', async () => {
  const db = memoryDb(),
    people = new PersonService(db);
  try {
    const { person } = await people.upsertFromSource({
      source: 'staff',
      fields: { email: 'account-roll@example.invalid' },
    });
    assert.ok(person.email);
    await people.linkIdentity(person.id, {
      platform: 'beehiiv',
      externalId: 'sub_account_roll',
      externalEmail: person.email,
      linkMethod: 'created_by_platform',
    });
    assert.equal(
      await recordCurrentMembershipRoll(db, {
        personId: person.id,
        externalId: 'sub_account_roll',
        status: 'active',
        observedAt: '2026-10-14T10:00:00.000Z',
      }),
      'applied',
    );
    const account = await accountView(db, person.id);
    assert.ok(account);
    assert.equal(account.onMailingList, true);
    assert.equal(account.memberSince, null);
    assert.equal(account.person.membership_status, 'member');
    assert.equal(
      await leaveMailingList(
        { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'roll-account-fixture' },
        person.id,
      ),
      'left',
    );
    const after = await accountView(db, person.id);
    assert.ok(after);
    assert.equal(after.onMailingList, false);
    assert.equal(after.person.membership_status, 'former_member');
    assert.equal(after.memberSince, null);
  } finally {
    db.raw.close();
  }
});
