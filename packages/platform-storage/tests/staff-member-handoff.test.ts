import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { PersonService } from '../src/person-service';
import { createSession, endSession } from '../src/auth';
import {
  beginMemberHandoff,
  approveMemberHandoff,
  staffHandoffProof,
} from '../src/staff-member-handoff';
void test('member proof is bound to the pending browser and auth mode and dies with its session', async () => {
  const db = memoryDb();
  try {
    const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture' };
    const { person } = await new PersonService(db).upsertFromSource({
      source: 'join_form',
      fields: { email: 'personal@example.org' },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    });
    const session = await createSession(env, person.id, 'member');
    const handoff = await beginMemberHandoff(env, 'browser-one', {
      mode: 'google',
      staffOrigin: 'https://staff.lasvegasfortransit.org',
    });
    assert.equal(
      await staffHandoffProof(env, handoff, { pending: 'browser-one', mode: 'google' }),
      null,
    );
    assert.equal(await approveMemberHandoff(env, handoff, session.token), true);
    assert.equal(
      (await staffHandoffProof(env, handoff, { pending: 'browser-one', mode: 'google' }))?.id,
      person.id,
    );
    assert.equal(
      await staffHandoffProof(env, handoff, { pending: 'browser-two', mode: 'google' }),
      null,
    );
    assert.equal(
      await staffHandoffProof(env, handoff, { pending: 'browser-one', mode: 'cloudflare-access' }),
      null,
    );
    assert.equal(await approveMemberHandoff(env, handoff, session.token), false);
    await endSession(env, session.token);
    assert.equal(
      await staffHandoffProof(env, handoff, { pending: 'browser-one', mode: 'google' }),
      null,
    );
  } finally {
    db.raw.close();
  }
});
