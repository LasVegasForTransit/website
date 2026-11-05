import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveStaffContext } from '../src/lib/context';
import { onboardingFixture } from './support/onboarding-fixture';

for (const method of ['GET', 'POST']) {
  void test(`an expired Discord cache refresh admits the original ${method} and then uses the fresh cache`, async () => {
    const f = await onboardingFixture();
    try {
      let calls = 0;
      const env = {
        ...f.env,
        LVBT_NEWSLETTER_JOBS: {
          fetch: async (request: Request) => {
            calls++;
            assert.equal(request.url, 'https://jobs.internal/discord/readiness');
            assert.equal(request.method, 'POST');
            assert.deepEqual(await request.json(), {
              personId: f.personId,
              environment: 'production',
            });
            f.db.raw
              .prepare('UPDATE discord_profiles SET expires_at=?')
              .run(new Date(Date.now() + 300000).toISOString());
            return Response.json({ kind: 'observed' });
          },
        },
      };
      const request = new Request(f.request(), {
        method,
        ...(method === 'POST' ? { body: 'event=123&attended=yes' } : {}),
      });
      const result = await resolveStaffContext(request, env);
      assert.ok(!(result instanceof Response));
      assert.equal(result.actor.personId, f.personId);
      assert.equal(new URL(request.url).pathname, '/paper/sheet/');
      if (method === 'POST') assert.equal(await request.text(), 'event=123&attended=yes');
      assert.equal(calls, 1);
      assert.ok(!((await resolveStaffContext(f.request(), env)) instanceof Response));
      assert.equal(calls, 1, 'fresh observations must not read the provider again');
    } finally {
      f.db.raw.close();
    }
  });
}
for (const outcome of [
  'outage',
  'departed',
  'screening',
  'disconnect',
  'suspended',
  'signed-out',
]) {
  void test(`a stale Discord read remains gated after ${outcome}`, async () => {
    const f = await onboardingFixture();
    try {
      let calls = 0;
      const env = {
        ...f.env,
        LVBT_NEWSLETTER_JOBS: {
          fetch: () => {
            calls++;
            if (outcome === 'outage') throw new Error('Provider unavailable');
            f.db.raw
              .prepare('UPDATE discord_profiles SET expires_at=?')
              .run(new Date(Date.now() + 300000).toISOString());
            if (outcome === 'departed')
              f.db.raw.prepare('UPDATE discord_profiles SET in_guild=0').run();
            if (outcome === 'screening')
              f.db.raw.prepare('UPDATE discord_profiles SET pending=1').run();
            if (outcome === 'disconnect')
              f.db.raw.prepare("DELETE FROM identities WHERE id='discord'").run();
            if (outcome === 'suspended')
              f.db.raw.prepare("UPDATE workspace_directory_accounts SET state='inactive'").run();
            if (outcome === 'signed-out') f.db.raw.prepare('DELETE FROM sessions').run();
            return Promise.resolve(Response.json({ kind: 'observed' }));
          },
        },
      };
      const result = await resolveStaffContext(f.request(), env);
      assert.ok(result instanceof Response);
      assert.equal(result.status, 303);
      assert.equal(calls, 1);
    } finally {
      f.db.raw.close();
    }
  });
}
for (const invalid of [
  'unverified',
  'wrong-guild',
  'multiple',
  'disconnected',
  'pending-disconnect',
  'suspended',
  'no-choice',
]) {
  void test(`a ${invalid} Discord or Workspace state cannot trigger automatic refresh`, async () => {
    const f = await onboardingFixture();
    try {
      if (invalid === 'unverified')
        f.db.raw
          .prepare("UPDATE identities SET link_method='created_by_platform' WHERE id='discord'")
          .run();
      if (invalid === 'wrong-guild')
        f.db.raw.prepare("UPDATE discord_profiles SET guild_id='555555555555555555'").run();
      if (invalid === 'multiple')
        f.db.raw
          .prepare(
            "INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at) SELECT 'other',person_id,platform,'555555555555555555',linked_at,link_method,created_at,updated_at FROM identities WHERE id='discord'",
          )
          .run();
      if (invalid === 'disconnected')
        f.db.raw.prepare("DELETE FROM identities WHERE id='discord'").run();
      if (invalid === 'pending-disconnect')
        f.db.raw
          .prepare(
            "INSERT INTO discord_disconnects(identity_record_id,requested_at,operation_id) VALUES('discord',?,'disconnect')",
          )
          .run(new Date().toISOString());
      if (invalid === 'suspended')
        f.db.raw.prepare("UPDATE workspace_directory_accounts SET state='inactive'").run();
      if (invalid === 'no-choice') f.db.raw.prepare('DELETE FROM staff_onboarding_sessions').run();
      let calls = 0;
      const result = await resolveStaffContext(f.request(), {
        ...f.env,
        LVBT_NEWSLETTER_JOBS: {
          fetch: () => {
            calls++;
            return Promise.resolve(Response.json({ kind: 'observed' }));
          },
        },
      });
      assert.ok(result instanceof Response);
      assert.equal(calls, 0);
    } finally {
      f.db.raw.close();
    }
  });
}
