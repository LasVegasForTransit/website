import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { PersonService } from '../src/person-service';
import { createSession, endSession } from '../src/auth';
import { hashWithSecret } from '@lasvegasfortransit/platform-core/signing';
import {
  beginMemberHandoff,
  approveMemberHandoff,
  staffHandoffProof,
  verifiedMemberProof,
} from '../src/staff-member-handoff';
import { SsoLinkService } from '../src/staff-sso';
import { WorkspaceLinkService } from '../src/workspace-pending';

for (const mode of ['google', 'cloudflare-access'] as const) {
  for (const invalidation of ['revoked', 'expired', 'deleted', 'ineligible'] as const) {
    void test(`${mode}: account handoff rejects a ${invalidation} public staff session`, async () => {
      const db = memoryDb();
      try {
        const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'staff-fixture' };
        const publicEnv = { ...env, LVBT_SIGN_IN_SECRET: 'public-fixture' };
        const { person } = await new PersonService(db).upsertFromSource({
          source: 'join_form',
          fields: { email: 'handoff@example.invalid' },
          consent: {
            scope: 'newsletter',
            source: 'join_form',
            method: 'checkbox',
            wordingVersion: 'fixture',
          },
        });
        const session = await createSession(publicEnv, person.id, 'staff');
        const sessionHash = await hashWithSecret(
          publicEnv.LVBT_SIGN_IN_SECRET,
          `session:${session.token}`,
        );
        assert.equal(await verifiedMemberProof(publicEnv, sessionHash), null);
        const service = mode === 'google' ? new WorkspaceLinkService(env) : new SsoLinkService(env);
        const pending = await service.begin(
          {
            issuer: 'https://fixture.cloudflareaccess.com',
            subject: 'workspace-fixture',
            email: 'handoff@lasvegasfortransit.org',
            expiresAt: new Date(Date.now() + 3600000),
            givenName: null,
            familyName: null,
          },
          { returnTo: '/' },
        );
        const handoff = await beginMemberHandoff(env, pending, {
          mode,
          staffOrigin: 'https://staff.lasvegasfortransit.org',
        });
        assert.equal(await approveMemberHandoff(publicEnv, handoff, session.token), true);
        assert.equal((await staffHandoffProof(env, handoff, { mode, pending }))?.id, person.id);
        assert.equal((await service.completeForMemberProof(pending, sessionHash)).kind, 'conflict');
        if (invalidation === 'revoked') await endSession(publicEnv, session.token);
        if (invalidation === 'expired')
          await db
            .prepare('UPDATE sessions SET expires_at=? WHERE id_hash=?')
            .bind('2000-01-01T00:00:00.000Z', sessionHash)
            .run();
        if (invalidation === 'deleted')
          await db
            .prepare('UPDATE people SET deleted_at=? WHERE id=?')
            .bind(new Date().toISOString(), person.id)
            .run();
        if (invalidation === 'ineligible')
          await db
            .prepare("UPDATE people SET membership_status='not_member' WHERE id=?")
            .bind(person.id)
            .run();
        assert.equal((await service.completeForMemberHandoff(pending, handoff)).kind, 'conflict');
        assert.ok(
          await service.pending(pending),
          'invalid account proof must not consume pending setup',
        );
        assert.equal(await staffHandoffProof(env, handoff, { mode, pending }), null);
        assert.equal(
          (
            await db
              .prepare('SELECT email_verified_at FROM people WHERE id=?')
              .bind(person.id)
              .first<{ email_verified_at: string | null }>()
          )?.email_verified_at,
          null,
        );
      } finally {
        db.raw.close();
      }
    });
  }
}
