import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFixture } from './support/merge-fixture';
import {
  saveTaskCheckinSource,
  putNotionTaskMapping,
  setTaskCheckinConsent,
  upsertNotionTaskSnapshot,
  recordTaskInteraction,
} from '../src/notion-task-checkins';
import { ensureTaskCard, attachTaskCardMessage } from '../src/notion-task-cards';
void test('merging and undoing a Discord identity cannot revive prior check-in consent or old task controls', async () => {
  const f = await mergeFixture(),
    now = new Date();
  try {
    await f.people.linkIdentity(f.merged.id, {
      platform: 'discord',
      externalId: '111111111111111111',
      linkMethod: 'self_linked',
    });
    await saveTaskCheckinSource(
      f.db,
      {
        sourceId: 'source',
        workspaceId: 'workspace',
        enabled: true,
        expectedRevision: 0,
        actorId: f.actor.personId,
        policy: { cohortPersonIds: [f.merged.id, f.survivor.id] },
      },
      now,
    );
    await f.people.linkIdentity(f.survivor.id, {
      platform: 'discord',
      externalId: '222222222222222222',
      linkMethod: 'self_linked',
    });
    await setTaskCheckinConsent(
      f.db,
      {
        sourceId: 'source',
        personId: f.survivor.id,
        discordUserId: '222222222222222222',
        state: 'opted_out',
        policyRevision: 1,
        interactionId: '100000000000000100',
      },
      now,
    );
    f.db.raw
      .prepare("DELETE FROM identities WHERE person_id=? AND platform='discord'")
      .run(f.survivor.id);
    await putNotionTaskMapping(
      f.db,
      {
        workspaceId: 'workspace',
        notionUserId: 'notion-member',
        personId: f.merged.id,
        confirmedBy: f.actor.personId,
      },
      now,
    );
    await setTaskCheckinConsent(
      f.db,
      {
        sourceId: 'source',
        personId: f.merged.id,
        discordUserId: '111111111111111111',
        state: 'active',
        policyRevision: 1,
        interactionId: '100000000000000002',
      },
      now,
    );
    await upsertNotionTaskSnapshot(
      f.db,
      {
        sourceId: 'source',
        taskId: 'task',
        revision: 'v1',
        sourceEditedAt: now.toISOString(),
        active: true,
        snapshot: { assigneeIds: ['notion-member'] },
      },
      now,
    );
    const card = await ensureTaskCard(
      f.db,
      { sourceId: 'source', taskId: 'task', personId: f.merged.id },
      now,
    );
    assert.ok(card);
    await attachTaskCardMessage(
      f.db,
      { token: card.token, channelId: 'private-channel', messageId: 'private-message' },
      now,
    );
    await recordTaskInteraction(
      f.db,
      {
        id: 'pending',
        sourceId: 'source',
        taskId: 'task',
        personId: f.merged.id,
        taskRevision: 'v1',
        consentRevision: 1,
        policyRevision: 1,
        kind: 'progress',
        payload: { text: 'Own task update' },
      },
      now,
    );
    const merged = await f.mergePeople(f.db, f.actor, f.input);
    assert.equal(merged.kind, 'ok');
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_consents WHERE person_id=?').get(f.merged.id)
        ?.state,
      'paused',
    );
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_operations').get()?.state,
      'superseded',
    );
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM task_checkin_cards').get()?.n, 0);
    const undone = await f.undoMerge(f.db, f.actor, {
      mergeId: merged.value.mergeId,
      reason: 'Confirmed separate records',
      operationId: 'undo-task-identity',
    });
    assert.equal(undone.kind, 'ok');
    assert.equal(
      f.db.raw
        .prepare('SELECT state FROM task_checkin_consents WHERE person_id=?')
        .get(f.survivor.id)?.state,
      'opted_out',
      'an existing stop choice stays stopped',
    );
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_consents WHERE person_id=?').get(f.merged.id)
        ?.state,
      'paused',
    );
    assert.equal(
      f.db.raw
        .prepare("SELECT count(*) AS n FROM task_checkin_consent_receipts WHERE state='active'")
        .get()?.n,
      1,
      'identity maintenance must not invent opt-in receipts',
    );
    assert.equal(
      await ensureTaskCard(
        f.db,
        { sourceId: 'source', taskId: 'task', personId: f.merged.id },
        new Date(),
      ),
      null,
    );
  } finally {
    f.db.raw.close();
  }
});
void test('the canonical profile can renew consent against one verified merged mapping and export its history until undo', async () => {
  const f = await mergeFixture(),
    now = new Date();
  const { createSession } = await import('../src/auth');
  const { hashWithSecret } = await import('@lasvegasfortransit/platform-core/signing');
  const { collectPersonExport } = await import('../src/person-export');
  const exportFor = async (personId: string) => {
    const session = await createSession(
      { PLATFORM_DB: f.db, LVBT_SIGN_IN_SECRET: 'merge-export-fixture' },
      personId,
      'member',
      new Date(),
    );
    return collectPersonExport(
      f.db,
      personId,
      {
        kind: 'member',
        personId,
        sessionHash: await hashWithSecret('merge-export-fixture', `session:${session.token}`),
      },
      new Date(),
    );
  };
  try {
    await f.people.linkIdentity(f.merged.id, {
      platform: 'discord',
      externalId: '111111111111111111',
      linkMethod: 'self_linked',
    });
    await saveTaskCheckinSource(
      f.db,
      {
        sourceId: 'source',
        workspaceId: 'workspace',
        enabled: true,
        expectedRevision: 0,
        actorId: f.actor.personId,
        policy: { cohortPersonIds: [f.merged.id, f.survivor.id] },
      },
      now,
    );
    await putNotionTaskMapping(
      f.db,
      {
        workspaceId: 'workspace',
        notionUserId: 'notion-member',
        personId: f.merged.id,
        confirmedBy: f.actor.personId,
      },
      now,
    );
    await setTaskCheckinConsent(
      f.db,
      {
        sourceId: 'source',
        personId: f.merged.id,
        discordUserId: '111111111111111111',
        state: 'active',
        policyRevision: 1,
        interactionId: '100000000000000004',
      },
      now,
    );
    await upsertNotionTaskSnapshot(
      f.db,
      {
        sourceId: 'source',
        taskId: 'task',
        revision: 'v1',
        sourceEditedAt: now.toISOString(),
        active: true,
        snapshot: { assigneeIds: ['notion-member'] },
      },
      now,
    );
    await recordTaskInteraction(
      f.db,
      {
        id: 'historical-response',
        sourceId: 'source',
        taskId: 'task',
        personId: f.merged.id,
        taskRevision: 'v1',
        consentRevision: 1,
        policyRevision: 1,
        kind: 'progress',
        payload: { text: 'Original own task history' },
      },
      now,
    );
    const combined = await f.mergePeople(f.db, f.actor, f.input);
    assert.equal(combined.kind, 'ok');
    assert.equal(
      await ensureTaskCard(
        f.db,
        { sourceId: 'source', taskId: 'task', personId: f.survivor.id },
        new Date(),
      ),
      null,
      'merge alone does not authorize delivery',
    );
    await setTaskCheckinConsent(
      f.db,
      {
        sourceId: 'source',
        personId: f.survivor.id,
        discordUserId: '111111111111111111',
        state: 'active',
        policyRevision: 1,
        interactionId: '100000000000000301',
      },
      new Date(),
    );
    assert.ok(
      await ensureTaskCard(
        f.db,
        { sourceId: 'source', taskId: 'task', personId: f.survivor.id },
        new Date(),
      ),
      'a reviewed canonical record can use the one verified Notion mapping after a new opt-in',
    );
    const canonical = await exportFor(f.survivor.id);
    assert.ok(canonical);
    assert.match(JSON.stringify(canonical.task_checkin_responses), /Original own task history/);
    assert.equal(
      f.db.raw
        .prepare("SELECT person_id FROM task_checkin_operations WHERE id='historical-response'")
        .get()?.person_id,
      f.merged.id,
      'history is not rewritten',
    );
    const undone = await f.undoMerge(f.db, f.actor, {
      mergeId: combined.value.mergeId,
      reason: 'Confirmed separate people',
      operationId: 'undo-history',
    });
    assert.equal(undone.kind, 'ok');
    const afterUndo = await exportFor(f.survivor.id);
    assert.ok(afterUndo);
    assert.equal(
      JSON.stringify(afterUndo.task_checkin_responses).includes('Original own task history'),
      false,
    );
    assert.match(
      JSON.stringify((await exportFor(f.merged.id))?.task_checkin_responses),
      /Original own task history/,
    );
    assert.equal(
      await ensureTaskCard(
        f.db,
        { sourceId: 'source', taskId: 'task', personId: f.merged.id },
        new Date(),
      ),
      null,
      'undo still requires renewed self-authored consent',
    );
  } finally {
    f.db.raw.close();
  }
});
