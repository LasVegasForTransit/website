import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFixture } from './support/merge-fixture';
import { rosterDetails } from '../src/roster-details';
import { WelcomeService } from '../src/welcome';
import { loadActor } from '../src/staff-roles';

void test('roster follow-up matches current welcome eligibility, claimant and completion', async () => {
  const { db, actor, survivor, people } = await mergeFixture();
  try {
    const welcome = new WelcomeService(db);
    let details = (await rosterDetails(db, actor, [survivor.id])).get(survivor.id);
    assert.deepEqual(details?.welcome, { claimedBy: null, claimedByName: null });
    assert.equal((await welcome.entry(actor, survivor.id))?.claimedBy, null);
    assert.equal((await welcome.claim(actor, survivor.id, { operationId: 'claim' })).kind, 'ok');
    details = (await rosterDetails(db, actor, [survivor.id])).get(survivor.id);
    assert.equal(details?.welcome?.claimedBy, actor.personId);
    assert.equal(details.welcome.claimedByName, 'Administrator');
    assert.equal(
      (
        await welcome.complete(actor, survivor.id, {
          operationId: 'complete',
          method: 'email',
          note: '',
        })
      ).kind,
      'ok',
    );
    assert.equal((await rosterDetails(db, actor, [survivor.id])).get(survivor.id)?.welcome, null);
    await people.withdrawConsent(survivor.id, {
      scope: 'newsletter',
      source: 'member',
      withdrawnAt: new Date().toISOString(),
    });
    assert.equal((await rosterDetails(db, actor, [survivor.id])).get(survivor.id)?.welcome, null);
  } finally {
    db.raw.close();
  }
});

void test('roster does not offer inaccessible or out-of-window welcome work', async () => {
  const { db, actor, admin, survivor, merged, committees } = await mergeFixture();
  try {
    await committees.assign({
      personId: merged.id,
      committeeId: 'events',
      role: 'lead',
      actorId: admin.id,
      operationId: 'lead',
    });
    await committees.assign({
      personId: survivor.id,
      committeeId: 'events',
      role: 'member',
      actorId: admin.id,
      operationId: 'member',
    });
    const lead = await loadActor(db, merged.id);
    assert.ok(lead);
    assert.equal((await rosterDetails(db, lead, [survivor.id])).get(survivor.id)?.welcome, null);
    const old = new Date(Date.now() - 61 * 86_400_000).toISOString();
    db.raw.prepare('UPDATE consent_records SET given_at=? WHERE person_id=?').run(old, survivor.id);
    assert.equal((await rosterDetails(db, actor, [survivor.id])).get(survivor.id)?.welcome, null);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    db.raw
      .prepare('UPDATE consent_records SET given_at=? WHERE person_id=?')
      .run(future, survivor.id);
    assert.equal((await rosterDetails(db, actor, [survivor.id])).get(survivor.id)?.welcome, null);
  } finally {
    db.raw.close();
  }
});
