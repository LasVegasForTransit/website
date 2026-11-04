import assert from 'node:assert/strict';
import test from 'node:test';
import {
  saveProjectHome,
  saveWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import {
  enqueueWorkOperation,
  claimWorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { resolveWorkActor } from '../src/discord-work-authority';
import { canWriteBacklink } from '../src/discord-work-backlink-guard';
import {
  discordUserId,
  projectId,
  projectSourceId,
  sourceId,
  workFixture,
  workNow,
  workScope,
} from './support/discord-work';

void test('project backlink stops when its admin grant is revoked even if the person remains a project lead', async () => {
  const { db, notion, project } = workFixture();
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture',
  });
  Object.assign(discord, {
    membership: () => Promise.resolve(true),
    inspectDestination: () =>
      Promise.resolve({
        audienceFingerprint: 'audience',
        canRead: true,
        locked: false,
        privateThread: false,
      }),
  });
  Object.assign(project.properties.Lead, { people: [{ id: 'notion-guest' }] });
  const home = {
    id: 'home',
    scope: workScope,
    projectSourceId,
    projectId,
    destination: { kind: 'forum' as const, channelId: '333333333333333333', parentId: null },
    taskParent: null,
    audienceFingerprint: 'audience',
    approvedBy: 'guest',
    state: 'active' as const,
    generation: 1,
  };
  const c = {
    id: 'c',
    scope: workScope,
    subject: { kind: 'project_plan' as const, sourceId: projectSourceId, pageId: projectId },
    homeId: home.id,
    placementProjectId: projectId,
    threadId: '555555555555555555',
    starterMessageId: '555555555555555555',
    mode: 'selected' as const,
    state: 'active' as const,
    generation: 1,
    activationId: '555555555555555555',
    cursorId: '555555555555555555',
    windowUpperId: null,
    windowBeforeId: null,
    footerBlockIds: [],
  };
  try {
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
      )
      .run(workNow.toISOString());
    db.raw
      .prepare(
        "INSERT INTO people(id,membership_status,created_at,updated_at) VALUES('backup','member',?,?)",
      )
      .run(workNow.toISOString(), workNow.toISOString());
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('backup','setup',?)",
      )
      .run(workNow.toISOString());
    await saveProjectHome(db, home, 0, workNow);
    await saveWorkConversation(db, c, 0, workNow);
    const actor = await resolveWorkActor(db, workScope, discordUserId);
    assert.ok(actor);
    await enqueueWorkOperation(
      db,
      {
        id: 'backlink',
        scope: workScope,
        homeId: home.id,
        conversationId: c.id,
        generation: 1,
        kind: 'backlink',
        sourceKey: 'backlink:c',
        actorPersonId: actor.personId,
        actorDiscordId: discordUserId,
        grantVersion: actor.grantVersion,
        originalAuthorId: discordUserId,
        payload: {},
      },
      workNow,
    );
    const op = await claimWorkOperation(db, workScope, workNow);
    assert.ok(op);
    db.raw.prepare("DELETE FROM staff_administrators WHERE person_id='guest'").run();
    assert.equal(
      await canWriteBacklink(
        db,
        { notion, discord },
        {
          c,
          op,
          context: {
            scope: workScope,
            taskSourceId: sourceId,
            enabled: true,
            clock: () => workNow,
          },
        },
      ),
      false,
    );
  } finally {
    db.raw.close();
  }
});
