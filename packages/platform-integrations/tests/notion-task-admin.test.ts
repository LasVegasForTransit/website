import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { loadActor } from '@lasvegasfortransit/platform-storage/staff-roles';
import { taskPolicy } from './support/task-checkins';
async function fixture() {
  const db = memoryDb(),
    stamp = new Date().toISOString();
  db.raw
    .prepare(
      "INSERT INTO people(id,membership_status,created_at,updated_at) VALUES('staff','member',?,?)",
    )
    .run(stamp, stamp);
  db.raw
    .prepare(
      "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('staff','staff',?)",
    )
    .run(stamp);
  const actor = await loadActor(db, 'staff');
  assert.ok(actor);
  const api = await import('../src/notion-task-admin').catch(() => null);
  assert.ok(api, 'staff configuration must enforce complete policy before enablement');
  return { db, actor, api };
}
void test('incomplete configuration can be saved paused but cannot enable delivery', async () => {
  const f = await fixture();
  try {
    const input = {
      sourceId: 'source',
      workspaceId: 'workspace',
      expectedRevision: 0,
      enabled: true,
      policy: { timezone: 'America/Los_Angeles' },
    };
    const rejected = await f.api.configureTaskCheckins(f.db, f.actor, input, new Date());
    assert.equal(rejected.kind, 'invalid');
    assert.ok('gaps' in rejected && rejected.gaps.includes('source'));
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM task_checkin_sources').get()?.n, 0);
    const saved = await f.api.configureTaskCheckins(
      f.db,
      f.actor,
      {
        ...input,
        enabled: false,
        policy: { ...input.policy, botToken: 'SECRET-MUST-NOT-PERSIST' },
      },
      new Date(),
    );
    assert.equal(saved.kind, 'ok');
    assert.equal(
      JSON.stringify(f.db.raw.prepare('SELECT * FROM task_checkin_sources').all()).includes(
        'SECRET-MUST-NOT-PERSIST',
      ),
      false,
    );
    assert.equal(
      (
        await f.api.configureTaskCheckins(
          f.db,
          f.actor,
          { ...input, expectedRevision: 1, policy: taskPolicy },
          new Date(),
        )
      ).kind,
      'ok',
    );
  } finally {
    f.db.raw.close();
  }
});
void test('configuration validation cannot bypass a revoked administrator', async () => {
  const f = await fixture();
  try {
    f.db.raw.prepare("UPDATE people SET membership_status='not_member' WHERE id='staff'").run();
    await assert.rejects(
      f.api.configureTaskCheckins(
        f.db,
        f.actor,
        {
          sourceId: 'source',
          workspaceId: 'workspace',
          expectedRevision: 0,
          enabled: true,
          policy: taskPolicy,
        },
        new Date(),
      ),
      /access/,
    );
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM task_checkin_sources').get()?.n, 0);
  } finally {
    f.db.raw.close();
  }
});

void test('pausing and resuming unchanged policy preserves volunteered consent without manufacturing a new opt-in', async () => {
  const f = await fixture();
  try {
    const s = await import('@lasvegasfortransit/platform-storage/notion-task-checkins');
    const stamp = new Date();
    f.db.raw
      .prepare("INSERT INTO people(id,created_at,updated_at) VALUES('member',?,?)")
      .run(stamp.toISOString(), stamp.toISOString());
    f.db.raw
      .prepare(
        "INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at) VALUES('discord','member','discord','111111111111111111',?,'self_linked',?,?)",
      )
      .run(stamp.toISOString(), stamp.toISOString(), stamp.toISOString());
    await f.api.configureTaskCheckins(
      f.db,
      f.actor,
      {
        sourceId: 'source',
        workspaceId: 'workspace',
        expectedRevision: 0,
        enabled: true,
        policy: taskPolicy,
      },
      stamp,
    );
    await s.putNotionTaskMapping(
      f.db,
      {
        workspaceId: 'workspace',
        notionUserId: 'notion-member',
        personId: 'member',
        confirmedBy: 'staff',
      },
      stamp,
    );
    assert.equal(
      await s.setTaskCheckinConsent(
        f.db,
        {
          sourceId: 'source',
          personId: 'member',
          discordUserId: '111111111111111111',
          interactionId: '100000000000000300',
          state: 'active',
          policyRevision: 1,
        },
        stamp,
      ),
      true,
    );
    for (const [expectedRevision, enabled] of [
      [1, false],
      [2, true],
    ] as const) {
      assert.equal(
        (
          await f.api.configureTaskCheckins(
            f.db,
            f.actor,
            {
              sourceId: 'source',
              workspaceId: 'workspace',
              expectedRevision,
              enabled,
              policy: taskPolicy,
            },
            stamp,
          )
        ).kind,
        'ok',
      );
      const consent = f.db.raw
        .prepare(
          "SELECT state,policy_revision,revision FROM task_checkin_consents WHERE person_id='member'",
        )
        .get();
      assert.equal(consent?.state, 'active');
      assert.equal(consent.policy_revision, expectedRevision + 1);
      assert.equal(consent.revision, 1);
    }
    assert.equal(
      f.db.raw.prepare('SELECT count(*) AS n FROM task_checkin_consent_receipts').get()?.n,
      1,
    );
    await f.api.configureTaskCheckins(
      f.db,
      f.actor,
      {
        sourceId: 'source',
        workspaceId: 'workspace',
        expectedRevision: 3,
        enabled: true,
        policy: { ...taskPolicy, overdueHours: [12] },
      },
      stamp,
    );
    assert.equal(
      f.db.raw
        .prepare("SELECT policy_revision FROM task_checkin_consents WHERE person_id='member'")
        .get()?.policy_revision,
      3,
      'a changed schedule still requires the volunteer to review it',
    );
  } finally {
    f.db.raw.close();
  }
});
