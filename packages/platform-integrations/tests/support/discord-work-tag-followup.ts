import assert from 'node:assert/strict';
import { seedActiveWorkRoute } from '@lasvegasfortransit/platform-storage/test-db';
import { retryFailedWorkTagChecks } from '@lasvegasfortransit/platform-storage/discord-work-requests';
import {
  enqueueWorkOperation,
  claimWorkOperation,
  readWorkOperation,
  settleWorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { processWorkTagSync, queueWorkTagSync } from '../../src/discord-work-tag-sync';
import { runWorkPreview } from '../../src/discord-work-setup';
import type { DiscordWorkClient } from '../../src/discord-work-provider';
import type { WorkActor, WorkConversation } from '../../src/discord-work-types';
import { discordUserId, projectSourceId, sourceId, workNow, workScope } from './discord-work';
import type { workFixture } from './discord-work';

export async function verifyTagFollowup({
  db,
  notion,
  project,
  discord,
  actor,
  conversation,
  homeId,
  categoryId,
  forumId,
  writes,
}: {
  db: ReturnType<typeof workFixture>['db'];
  notion: ReturnType<typeof workFixture>['notion'];
  project: ReturnType<typeof workFixture>['project'];
  discord: DiscordWorkClient;
  actor: WorkActor;
  conversation: WorkConversation;
  homeId: string;
  categoryId: string;
  forumId: string;
  writes: number;
}): Promise<void> {
  seedActiveWorkRoute(
    db,
    {
      id: 'route',
      scope: workScope,
      sourceId: projectSourceId,
      kind: 'project',
      state: 'active',
      revision: 1,
      trigger: { property: 'Status', values: ['Ready'] },
      destination: { kind: 'category', channelId: categoryId },
      tagSync: { property: 'stage-id', mappings: [{ value: 'Ready', tagName: 'Ready' }] },
      approvedBy: actor.personId,
      approvedDiscordId: discordUserId,
      approvedGrantVersion: actor.grantVersion,
      audienceFingerprint: 'audience',
    },
    workNow,
  );
  const scheduling = {
    scope: workScope,
    taskSourceId: sourceId,
    enabled: true,
    clock: () => workNow,
  };
  assert.equal(
    await queueWorkTagSync(db, conversation, '2026-10-22T12:00:00.000Z', scheduling),
    true,
  );
  assert.equal(
    await queueWorkTagSync(db, conversation, '2026-10-22T12:00:00.000Z', scheduling),
    false,
  );
  assert.equal(
    await queueWorkTagSync(db, conversation, '2026-10-22T12:01:00.000Z', scheduling),
    false,
  );
  assert.equal(
    db.raw
      .prepare(
        "SELECT count(*) AS n FROM discord_work_operations WHERE kind='refresh' AND state='queued'",
      )
      .get()?.n,
    1,
  );
  Object.assign(project.properties, {
    Stage: { id: 'stage-id', type: 'select', select: { name: 'Unmapped' } },
  });
  const unmapped = await claimWorkOperation(db, workScope, workNow);
  assert.ok(unmapped);
  const failed = await processWorkTagSync(db, { notion, discord }, unmapped, scheduling);
  assert.equal(failed.reason, 'tag_mapping_unavailable');
  assert.equal((await readWorkOperation(db, workScope, unmapped.id))?.state, 'failed');
  assert.equal(writes, 1);
  assert.equal(
    await retryFailedWorkTagChecks(
      db,
      { personId: 'other' },
      { scope: workScope, routeId: 'route', revision: 1 },
      workNow,
    ),
    false,
  );
  assert.equal(
    await retryFailedWorkTagChecks(
      db,
      actor,
      { scope: workScope, routeId: 'route', revision: 2 },
      workNow,
    ),
    false,
  );
  db.raw
    .prepare(
      "UPDATE discord_work_operations SET state='held',reason='unconfirmed_effect' WHERE id=?",
    )
    .run(unmapped.id);
  const heldBase = {
    applicationId: '444444444444444444',
    guildId: workScope.guildId,
    discordUserId,
    channelId: forumId,
    interactionId: '999999999999999998',
  };
  await runWorkPreview(
    db,
    { notion, discord },
    { ...heldBase, intent: { action: 'routes' } },
    scheduling,
  );
  const heldList = db.raw
    .prepare(
      "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route-list' ORDER BY rowid DESC LIMIT 1",
    )
    .get();
  assert.ok(heldList);
  const heldStatus = await runWorkPreview(
    db,
    { notion, discord },
    {
      ...heldBase,
      intent: { action: 'route-manage', linkId: String(heldList.id), value: 'route' },
    },
    scheduling,
  );
  assert.match(JSON.stringify(heldStatus), /tag update may have succeeded/i);
  assert.equal(
    await retryFailedWorkTagChecks(
      db,
      actor,
      { scope: workScope, routeId: 'route', revision: 1 },
      workNow,
    ),
    false,
  );
  db.raw
    .prepare(
      "UPDATE discord_work_operations SET state='failed',reason='tag_mapping_unavailable' WHERE id=?",
    )
    .run(unmapped.id);
  assert.equal(
    await retryFailedWorkTagChecks(
      db,
      actor,
      { scope: workScope, routeId: 'route', revision: 1 },
      workNow,
    ),
    true,
  );
  assert.equal((await readWorkOperation(db, workScope, unmapped.id))?.state, 'queued');
  db.raw
    .prepare(
      "UPDATE discord_work_operations SET state='failed',reason='tag_mapping_unavailable' WHERE id=?",
    )
    .run(unmapped.id);
  const base = {
    applicationId: '444444444444444444',
    guildId: workScope.guildId,
    discordUserId,
    channelId: forumId,
    interactionId: '999999999999999999',
  };
  await runWorkPreview(
    db,
    { notion, discord },
    { ...base, intent: { action: 'routes' } },
    scheduling,
  );
  const list = db.raw
    .prepare(
      "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route-list' ORDER BY rowid DESC LIMIT 1",
    )
    .get();
  assert.ok(list);
  const management = await runWorkPreview(
    db,
    { notion, discord },
    { ...base, intent: { action: 'route-manage', linkId: String(list.id), value: 'route' } },
    scheduling,
  );
  assert.match(JSON.stringify(management), /Retry checks/);
  assert.match(JSON.stringify(management), /Check the Notion value and mapped forum tag/);
  const control = db.raw
    .prepare(
      "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route-manage' ORDER BY rowid DESC LIMIT 1",
    )
    .get();
  assert.ok(control);
  const retry = await runWorkPreview(
    db,
    { notion, discord },
    { ...base, intent: { action: 'route-retry-checks', linkId: String(control.id) } },
    scheduling,
  );
  assert.match(JSON.stringify(retry), /Checks queued/);
  assert.equal((await readWorkOperation(db, workScope, unmapped.id))?.state, 'queued');
  db.raw
    .prepare(
      "UPDATE discord_work_operations SET state='failed',reason='tag_mapping_unavailable' WHERE id=?",
    )
    .run(unmapped.id);
  await enqueueWorkOperation(
    db,
    {
      id: 'later',
      scope: workScope,
      homeId: homeId,
      conversationId: conversation.id,
      generation: 1,
      kind: 'refresh',
      sourceKey: 'tags:later',
      actorPersonId: actor.personId,
      actorDiscordId: discordUserId,
      grantVersion: actor.grantVersion,
      originalAuthorId: discordUserId,
      payload: { intent: 'tag-sync', routeId: 'route', routeRevision: 1 },
    },
    workNow,
  );
  const later = await claimWorkOperation(db, workScope, workNow);
  assert.ok(later);
  assert.equal(later.id, 'later');
  await settleWorkOperation(
    db,
    { id: later.id, token: later.claim_token },
    { state: 'confirmed' },
    workNow,
  );
  assert.equal(
    await retryFailedWorkTagChecks(
      db,
      actor,
      { scope: workScope, routeId: 'route', revision: 1 },
      workNow,
    ),
    false,
  );
  await runWorkPreview(
    db,
    { notion, discord },
    { ...base, intent: { action: 'routes' } },
    scheduling,
  );
  const nextList = db.raw
    .prepare(
      "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route-list' ORDER BY rowid DESC LIMIT 1",
    )
    .get();
  assert.ok(nextList);
  const resolved = await runWorkPreview(
    db,
    { notion, discord },
    {
      ...base,
      intent: { action: 'route-manage', linkId: String(nextList.id), value: 'route' },
    },
    scheduling,
  );
  assert.doesNotMatch(JSON.stringify(resolved), /Check the Notion value and mapped forum tag/);
}
