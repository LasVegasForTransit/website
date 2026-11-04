import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enqueueWorkOperation,
  claimWorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import {
  listProjectHomes,
  saveProjectHome,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { resolveWorkActor } from '../src/discord-work-authority';
import { DiscordWorkClient } from '../src/discord-work-provider';
import {
  workFixture,
  workScope,
  workNow,
  sourceId,
  projectId,
  projectSourceId,
  discordUserId,
} from './support/discord-work';
void test('a project with an existing home never creates another forum', async () => {
  const { processWorkProvision } = await import('../src/discord-work-provision');
  const { db, notion } = workFixture();
  db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
  db.raw
    .prepare(
      "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
    )
    .run(workNow.toISOString());
  let writes = 0;
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  Object.assign(discord, {
    membership: () => Promise.resolve(true),
    inspectDestination: () => {
      writes++;
      throw new Error('unexpected destination access');
    },
  });
  try {
    const actor = await resolveWorkActor(db, workScope, discordUserId);
    assert.ok(actor);
    await saveProjectHome(
      db,
      {
        id: 'existing',
        scope: workScope,
        projectSourceId,
        projectId,
        destination: { kind: 'forum', channelId: '333333333333333333', parentId: null },
        taskParent: null,
        audienceFingerprint: 'audience',
        approvedBy: actor.personId,
        state: 'active',
        generation: 1,
      },
      0,
      workNow,
    );
    await enqueueWorkOperation(
      db,
      {
        id: 'op',
        scope: workScope,
        homeId: null,
        conversationId: null,
        generation: 1,
        kind: 'provision',
        sourceKey: 'new-request',
        actorPersonId: actor.personId,
        actorDiscordId: discordUserId,
        grantVersion: actor.grantVersion,
        originalAuthorId: discordUserId,
        payload: {
          intent: 'home',
          linkId: 'different-home',
          subject: {
            kind: 'project_plan',
            sourceId: projectSourceId.replaceAll('-', ''),
            pageId: projectId.replaceAll('-', ''),
          },
          title: 'Project',
          destinationId: '333333333333333333',
          audienceFingerprint: 'audience',
          createForum: true,
        },
      },
      workNow,
    );
    const op = await claimWorkOperation(db, workScope, workNow);
    assert.ok(op);
    await processWorkProvision(db, { notion, discord }, op, {
      scope: workScope,
      taskSourceId: sourceId,
      enabled: true,
      clock: () => workNow,
    });
    assert.equal(writes, 0);
  } finally {
    db.raw.close();
  }
});

void test('an expired provisioning lease cannot start a forum overview post', async () => {
  const { processWorkProvision } = await import('../src/discord-work-provision');
  const { db, notion } = workFixture();
  const categoryId = '333333333333333333',
    forumId = '666666666666666666';
  let clock = workNow,
    posts = 0;
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  Object.assign(discord, {
    membership: () => Promise.resolve(true),
    inspectDestination: (id: string) => {
      if (id === forumId) clock = new Date(workNow.getTime() + 61_000);
      return Promise.resolve({
        isCategory: id === categoryId,
        destination: {
          kind: 'forum',
          channelId: id,
          parentId: id === categoryId ? null : categoryId,
        },
        audienceFingerprint: 'approved',
        canRead: true,
        canSend: true,
        canManageChannels: true,
        canCreateThreads: true,
        archived: false,
        locked: false,
        requiredTag: false,
        tags: [],
      });
    },
    createProjectForum: () => Promise.resolve({ channelId: forumId }),
    createTaskConversation: () => {
      posts++;
      return Promise.reject(new Error('unexpected post'));
    },
  });
  try {
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
      )
      .run(workNow.toISOString());
    const actor = await resolveWorkActor(db, workScope, discordUserId);
    assert.ok(actor);
    await enqueueWorkOperation(
      db,
      {
        id: 'lease',
        scope: workScope,
        homeId: null,
        conversationId: null,
        generation: 1,
        kind: 'provision',
        sourceKey: 'lease',
        actorPersonId: actor.personId,
        actorDiscordId: discordUserId,
        grantVersion: actor.grantVersion,
        originalAuthorId: discordUserId,
        payload: {
          intent: 'home',
          linkId: 'home',
          subject: { kind: 'project_plan', sourceId: projectSourceId, pageId: projectId },
          title: 'Project',
          destinationId: categoryId,
          audienceFingerprint: 'approved',
          createForum: true,
          tagIds: [],
        },
      },
      workNow,
    );
    const op = await claimWorkOperation(db, workScope, workNow);
    assert.ok(op);
    await processWorkProvision(db, { notion, discord }, op, {
      scope: workScope,
      taskSourceId: sourceId,
      enabled: true,
      clock: () => clock,
    });
    assert.equal(posts, 0);
    assert.equal((await listProjectHomes(db, workScope)).length, 0);
    const row = db.raw
      .prepare("SELECT result_json FROM discord_work_operations WHERE id='lease'")
      .get();
    assert.equal(
      (JSON.parse(String(row?.result_json)) as { postPhase?: string }).postPhase,
      'not_started',
    );
  } finally {
    db.raw.close();
  }
});
