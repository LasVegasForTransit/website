import assert from 'node:assert/strict';
import { mergeFixture } from './merge-fixture';
import {
  saveTaskCheckinSource,
  putNotionTaskMapping,
  setTaskCheckinConsent,
  upsertNotionTaskSnapshot,
  recordTaskInteraction,
} from '../../src/notion-task-checkins';
export async function taskMergeFixture() {
  const f = await mergeFixture(),
    now = new Date();
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
      policy: {
        cohortPersonIds: [f.merged.id, f.survivor.id],
        notificationLimit24h: 1,
        notificationGapMinutes: 60,
      },
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
      interactionId: '100000000000000001',
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
      id: 'history',
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
  const combine = async () => {
    const result = await f.mergePeople(f.db, f.actor, f.input);
    assert.equal(result.kind, 'ok');
    await setTaskCheckinConsent(
      f.db,
      {
        sourceId: 'source',
        personId: f.survivor.id,
        discordUserId: '111111111111111111',
        state: 'active',
        policyRevision: 1,
        interactionId: '100000000000000300',
      },
      new Date(),
    );
    return result;
  };
  return { ...f, now, combine };
}
