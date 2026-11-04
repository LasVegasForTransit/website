import assert from 'node:assert/strict';
import test from 'node:test';
import {
  saveProjectHome,
  readProjectHome,
  setProjectEventForumTags,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { resolveEventProjectForum } from '../src/discord-work-event-project';
import {
  projectId,
  projectSourceId,
  workFixture,
  workNow,
  workScope,
} from './support/discord-work';

void test('project event placement requires one related project and its approved forum audience', async () => {
  const { db, notion } = workFixture();
  Object.assign(notion, {
    readPage: () =>
      Promise.resolve({
        object: 'page',
        id: projectId,
        parent: { data_source_id: projectSourceId },
      }),
  });
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  const categoryId = '333333333333333333',
    forumId = '555555555555555555';
  let audience = 'approved';
  Object.assign(discord, {
    inspectDestination: (id: string) =>
      Promise.resolve({
        isCategory: id === categoryId,
        destination: { kind: 'forum', channelId: forumId, parentId: categoryId },
        audienceFingerprint: audience,
        canRead: true,
        canSend: true,
        archived: false,
        locked: false,
      }),
  });
  const page = {
    id: '10000000-0000-4000-8000-000000000002',
    properties: { Project: { type: 'relation', relation: [{ id: projectId }], has_more: false } },
  };
  const input = {
    page,
    relation: 'Project',
    projectSourceId,
    categoryId,
    audienceFingerprint: 'approved',
  };
  try {
    assert.deepEqual(await resolveEventProjectForum(db, { notion, discord }, workScope, input), {
      kind: 'unavailable',
      reason: 'project_forum_unavailable',
    });
    await saveProjectHome(
      db,
      {
        id: 'home',
        scope: workScope,
        projectSourceId,
        projectId,
        destination: { kind: 'forum', channelId: forumId, parentId: categoryId },
        taskParent: null,
        audienceFingerprint: 'approved',
        approvedBy: 'guest',
        state: 'active',
        generation: 1,
      },
      0,
      workNow,
    );
    assert.deepEqual(await resolveEventProjectForum(db, { notion, discord }, workScope, input), {
      kind: 'ready',
      projectId: projectId.replaceAll('-', ''),
      forumId,
      tagIds: [],
    });
    audience = 'changed';
    assert.deepEqual(await resolveEventProjectForum(db, { notion, discord }, workScope, input), {
      kind: 'unavailable',
      reason: 'audience_or_permission_changed',
    });
    audience = 'approved';
    const ambiguous = {
      ...page,
      properties: {
        Project: {
          type: 'relation',
          relation: [{ id: projectId }, { id: '10000000000040008000000000000005' }],
          has_more: false,
        },
      },
    };
    assert.deepEqual(
      await resolveEventProjectForum(db, { notion, discord }, workScope, {
        ...input,
        page: ambiguous,
      }),
      { kind: 'unavailable', reason: 'project_choice_required' },
    );
    assert.deepEqual(
      await resolveEventProjectForum(
        db,
        { notion, discord },
        { ...workScope, workspaceId: 'other' },
        input,
      ),
      { kind: 'unavailable', reason: 'project_forum_unavailable' },
    );
    Object.assign(notion, {
      readProperty: () =>
        Promise.resolve({
          results: [
            { type: 'relation', relation: { id: projectId } },
            { type: 'relation', relation: { id: '10000000000040008000000000000005' } },
          ],
          nextCursor: null,
        }),
    });
    const truncated = {
      ...page,
      properties: {
        Project: {
          id: 'property',
          type: 'relation',
          relation: [{ id: projectId }],
          has_more: true,
        },
      },
    };
    assert.deepEqual(
      await resolveEventProjectForum(db, { notion, discord }, workScope, {
        ...input,
        page: truncated,
      }),
      { kind: 'unavailable', reason: 'project_choice_required' },
    );
  } finally {
    db.raw.close();
  }
});

void test('only an administrator can save event tags for the current project forum', async () => {
  const { db } = workFixture();
  const home = {
    id: 'tag-home',
    scope: workScope,
    projectSourceId,
    projectId,
    destination: {
      kind: 'forum' as const,
      channelId: '555555555555555555',
      parentId: '333333333333333333',
    },
    taskParent: null,
    audienceFingerprint: 'approved',
    approvedBy: 'guest',
    state: 'active' as const,
    generation: 1,
  };
  try {
    await saveProjectHome(db, home, 0, workNow);
    const tag = '666666666666666666';
    assert.equal(
      await setProjectEventForumTags(db, { personId: 'guest' }, { home, tagIds: [tag] }, workNow),
      false,
    );
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
      )
      .run(workNow.toISOString());
    assert.equal(
      await setProjectEventForumTags(db, { personId: 'guest' }, { home, tagIds: [tag] }, workNow),
      true,
    );
    assert.deepEqual((await readProjectHome(db, workScope, home.id))?.eventForumTags, {
      forumId: home.destination.channelId,
      tagIds: [tag],
    });
    assert.equal(
      await setProjectEventForumTags(db, { personId: 'guest' }, { home, tagIds: [] }, workNow),
      false,
    );
    assert.equal(
      await setProjectEventForumTags(
        db,
        { personId: 'guest' },
        {
          home: { ...home, destination: { ...home.destination, channelId: '777777777777777777' } },
          tagIds: [tag],
        },
        workNow,
      ),
      false,
    );
    assert.equal(
      await setProjectEventForumTags(
        db,
        { personId: 'guest' },
        { home, tagIds: [tag, tag] },
        workNow,
      ),
      false,
    );
    assert.equal(
      db.raw
        .prepare(
          "SELECT count(*) AS n FROM staff_audits WHERE action='discord_work.set_project_event_forum_tags'",
        )
        .get()?.n,
      1,
    );
  } finally {
    db.raw.close();
  }
});
