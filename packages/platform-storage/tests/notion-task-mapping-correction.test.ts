import assert from 'node:assert/strict';
import test from 'node:test';
import { ready, now, operation } from './support/task-checkins';
import { loadActor } from '../src/staff-roles';
import { ensureTaskCard } from '../src/notion-task-cards';
import { taskMergeFixture } from './support/task-merge-fixture';
async function fixture() {
  const f = await ready();
  f.db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='staff'").run();
  f.db.raw
    .prepare(
      "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('staff','staff',?)",
    )
    .run(now.toISOString());
  f.db.raw
    .prepare(
      'UPDATE task_checkin_sources SET policy_json=json_set(policy_json,\'$.cohortPersonIds\',json(\'["member","guest"]\'))',
    )
    .run();
  f.db.raw
    .prepare(
      `INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at)
    VALUES('guest-discord','guest','discord','333333333333333333',?,'self_linked',?,?)`,
    )
    .run(now.toISOString(), now.toISOString(), now.toISOString());
  await f.s.setTaskCheckinConsent(
    f.db,
    {
      sourceId: 'source',
      personId: 'guest',
      discordUserId: '333333333333333333',
      state: 'active',
      policyRevision: 1,
      interactionId: '100000000000000003',
    },
    now,
  );
  const actor = await loadActor(f.db, 'staff');
  assert.ok(actor);
  const api = await import('../src/notion-task-mapping-admin').catch(() => null);
  assert.ok(api, 'administrators need an atomic identity-correction service');
  return { ...f, actor, api };
}
void test('a corrected mapping pauses affected people, invalidates old controls and preserves historical ownership', async () => {
  const { db, s, actor, api } = await fixture();
  try {
    for (const [id, workspace] of [
      ['same-workspace', 'workspace'],
      ['other-workspace', 'other'],
    ] as const) {
      db.raw
        .prepare(
          `INSERT INTO task_checkin_sources(id,workspace_id,revision,enabled,policy_json,updated_at)
        SELECT ?,?,revision,enabled,policy_json,updated_at FROM task_checkin_sources WHERE id='source'`,
        )
        .run(id, workspace);
      db.raw
        .prepare(
          `INSERT INTO task_checkin_consents(source_id,person_id,discord_user_id,state,revision,policy_revision,interaction_id,updated_at)
        SELECT ?,person_id,discord_user_id,state,revision,policy_revision,interaction_id,updated_at FROM task_checkin_consents WHERE source_id='source'`,
        )
        .run(id);
    }
    const card = await ensureTaskCard(
      db,
      { sourceId: 'source', taskId: 'task', personId: 'member' },
      now,
    );
    assert.ok(card);
    await s.recordTaskInteraction(db, operation, now);
    const claim = await s.claimTaskOperation(db, operation.id, now);
    assert.ok(claim);
    const before = await api.readTaskCheckinMapping(db, actor, {
      sourceId: 'source',
      notionUserId: 'notion-member',
    });
    assert.ok(before);
    assert.equal(
      await api.correctTaskCheckinMapping(
        db,
        actor,
        {
          sourceId: 'source',
          expectedRevision: 1,
          notionUserId: 'notion-member',
          expectedVersion: before.version,
          expectedPersonId: 'member',
          personId: 'guest',
        },
        now,
      ),
      true,
    );
    const after = await api.readTaskCheckinMapping(db, actor, {
      sourceId: 'source',
      notionUserId: 'notion-member',
    });
    assert.equal(after?.person_id, 'guest');
    assert.notEqual(after.version, before.version);
    assert.deepEqual(
      db.raw
        .prepare(
          "SELECT state FROM task_checkin_consents WHERE source_id<>'other-workspace' ORDER BY person_id",
        )
        .all()
        .map((r) => r.state),
      ['paused', 'paused', 'paused', 'paused'],
    );
    assert.deepEqual(
      db.raw
        .prepare(
          "SELECT state FROM task_checkin_consents WHERE source_id='other-workspace' ORDER BY person_id",
        )
        .all()
        .map((r) => r.state),
      ['active', 'active'],
    );
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM task_checkin_cards').get()?.n, 0);
    assert.equal(
      db.raw.prepare('SELECT person_id FROM task_checkin_operations').get()?.person_id,
      'member',
    );
    assert.equal(await s.readTaskActionContext(db, claim, now), null);
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM task_checkin_consent_receipts').get()?.n,
      2,
    );
    assert.equal(
      db.raw.prepare("SELECT membership_status FROM people WHERE id='guest'").get()
        ?.membership_status,
      'not_member',
    );
    assert.equal(
      await ensureTaskCard(db, { sourceId: 'source', taskId: 'task', personId: 'guest' }, now),
      null,
    );
    await s.setTaskCheckinConsent(
      db,
      {
        sourceId: 'source',
        personId: 'guest',
        discordUserId: '333333333333333333',
        state: 'active',
        policyRevision: 1,
        interactionId: '100000000000000300',
      },
      now,
    );
    assert.ok(
      await ensureTaskCard(db, { sourceId: 'source', taskId: 'task', personId: 'guest' }, now),
    );
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM staff_audits').get()?.n, 1);
  } finally {
    db.raw.close();
  }
});
void test('a new staff-confirmed match cannot silently give one merged family two Notion accounts', async () => {
  const f = await taskMergeFixture();
  try {
    await f.combine();
    const { confirmTaskCheckinMapping } = await import('../src/notion-task-admin');
    assert.equal(
      await confirmTaskCheckinMapping(
        f.db,
        f.actor,
        {
          sourceId: 'source',
          expectedRevision: 1,
          notionUserId: 'second-account',
          personId: f.survivor.id,
        },
        new Date(),
      ),
      false,
    );
  } finally {
    f.db.raw.close();
  }
});
void test('removing a mapping is explicit and a stale form cannot remove a recreated match', async () => {
  const { db, actor, api } = await fixture();
  try {
    const before = await api.readTaskCheckinMapping(db, actor, {
      sourceId: 'source',
      notionUserId: 'notion-member',
    });
    assert.ok(before);
    const input = {
      sourceId: 'source',
      expectedRevision: 1,
      notionUserId: 'notion-member',
      expectedVersion: before.version,
      expectedPersonId: 'member',
      personId: null,
    };
    assert.equal(await api.correctTaskCheckinMapping(db, actor, input, now), true);
    assert.equal(
      await api.readTaskCheckinMapping(db, actor, {
        sourceId: 'source',
        notionUserId: 'notion-member',
      }),
      null,
    );
    const { confirmTaskCheckinMapping } = await import('../src/notion-task-admin');
    assert.equal(
      await confirmTaskCheckinMapping(
        db,
        actor,
        {
          sourceId: 'source',
          expectedRevision: 1,
          notionUserId: 'notion-member',
          personId: 'member',
        },
        now,
      ),
      true,
    );
    assert.equal(await api.correctTaskCheckinMapping(db, actor, input, now), false);
    assert.ok(
      await api.readTaskCheckinMapping(db, actor, {
        sourceId: 'source',
        notionUserId: 'notion-member',
      }),
    );
  } finally {
    db.raw.close();
  }
});
void test('failed audit or stale policy cannot apply any part of a mapping correction', async () => {
  const { db, actor, api } = await fixture();
  try {
    const before = await api.readTaskCheckinMapping(db, actor, {
      sourceId: 'source',
      notionUserId: 'notion-member',
    });
    assert.ok(before);
    const input = {
      sourceId: 'source',
      expectedRevision: 1,
      notionUserId: 'notion-member',
      expectedVersion: before.version,
      expectedPersonId: 'member',
      personId: 'guest',
    };
    assert.equal(
      await api.correctTaskCheckinMapping(db, actor, { ...input, expectedRevision: 2 }, now),
      false,
    );
    db.raw.exec(
      "CREATE TRIGGER fail_mapping_audit BEFORE INSERT ON staff_audits BEGIN SELECT RAISE(ABORT,'audit unavailable'); END",
    );
    await assert.rejects(api.correctTaskCheckinMapping(db, actor, input, now), /audit unavailable/);
    assert.equal(
      (
        await api.readTaskCheckinMapping(db, actor, {
          sourceId: 'source',
          notionUserId: 'notion-member',
        })
      )?.person_id,
      'member',
    );
    assert.deepEqual(
      db.raw
        .prepare('SELECT state FROM task_checkin_consents ORDER BY person_id')
        .all()
        .map((r) => r.state),
      ['active', 'active'],
    );
  } finally {
    db.raw.close();
  }
});
void test('resolving a merged-family conflict pauses the whole family instead of reviving consent', async () => {
  const f = await taskMergeFixture();
  try {
    const { putNotionTaskMapping } = await import('../src/notion-task-checkins');
    await putNotionTaskMapping(
      f.db,
      {
        workspaceId: 'workspace',
        notionUserId: 'second-account',
        personId: f.survivor.id,
        confirmedBy: f.actor.personId,
      },
      f.now,
    );
    await f.combine();
    const api = await import('../src/notion-task-mapping-admin');
    const mapping = await api.readTaskCheckinMapping(f.db, f.actor, {
      sourceId: 'source',
      notionUserId: 'second-account',
    });
    assert.ok(mapping);
    assert.equal(mapping.conflicting_notion_user_id, 'notion-member');
    assert.equal(
      await api.correctTaskCheckinMapping(
        f.db,
        f.actor,
        {
          sourceId: 'source',
          expectedRevision: 1,
          notionUserId: 'second-account',
          expectedVersion: mapping.version,
          expectedPersonId: f.survivor.id,
          personId: null,
        },
        new Date(),
      ),
      true,
    );
    assert.equal(
      f.db.raw.prepare("SELECT count(*) AS n FROM task_checkin_consents WHERE state='active'").get()
        ?.n,
      0,
    );
    assert.equal(
      f.db.raw.prepare('SELECT person_id FROM task_checkin_mappings').get()?.person_id,
      f.merged.id,
    );
    assert.equal(
      f.db.raw.prepare("SELECT person_id FROM task_checkin_operations WHERE id='history'").get()
        ?.person_id,
      f.merged.id,
    );
  } finally {
    f.db.raw.close();
  }
});
void test('administrator revocation at the write boundary leaves the mapping and choices unchanged', async () => {
  const { db, actor, api } = await fixture();
  try {
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','staff',?)",
      )
      .run(now.toISOString());
    const mapping = await api.readTaskCheckinMapping(db, actor, {
      sourceId: 'source',
      notionUserId: 'notion-member',
    });
    assert.ok(mapping);
    const racing = {
      prepare: db.prepare.bind(db),
      batch: async (statements: Parameters<typeof db.batch>[0]) => {
        db.raw.prepare("DELETE FROM staff_administrators WHERE person_id='staff'").run();
        return await db.batch(statements);
      },
    };
    assert.equal(
      await api.correctTaskCheckinMapping(
        racing,
        actor,
        {
          sourceId: 'source',
          expectedRevision: 1,
          notionUserId: 'notion-member',
          expectedVersion: mapping.version,
          expectedPersonId: 'member',
          personId: 'guest',
        },
        now,
      ),
      false,
    );
    assert.equal(
      db.raw.prepare('SELECT person_id FROM task_checkin_mappings').get()?.person_id,
      'member',
    );
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM staff_audits').get()?.n, 0);
  } finally {
    db.raw.close();
  }
});
