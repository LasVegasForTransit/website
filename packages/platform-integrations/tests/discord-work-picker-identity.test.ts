import assert from 'node:assert/strict';
import test from 'node:test';
import { saveProjectHome } from '@lasvegasfortransit/platform-storage/discord-work-links';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { workTaskPicker } from '../src/discord-work-setup-tasks';
import {
  workFixture,
  workScope,
  workNow,
  sourceId,
  projectId,
  projectSourceId,
  discordUserId,
  taskId,
} from './support/discord-work';

void test('the task picker recognizes equivalent project IDs and excludes other projects', async () => {
  const { db, notion, task, project } = workFixture();
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  Object.assign(notion, {
    readPage: () => Promise.resolve(project),
    queryTasksForProject: () => Promise.resolve({ results: [task], nextCursor: null }),
  });
  const input = {
    applicationId: '444444444444444444',
    guildId: workScope.guildId,
    discordUserId,
    channelId: '333333333333333333',
    interactionId: '777777777777777777',
    intent: { action: 'tasks', linkId: 'home' },
  };
  const context = { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => workNow };
  try {
    await saveProjectHome(
      db,
      {
        id: 'home',
        scope: workScope,
        projectSourceId,
        projectId: projectId.replaceAll('-', '').toUpperCase(),
        destination: { kind: 'forum', channelId: input.channelId, parentId: null },
        taskParent: null,
        audienceFingerprint: 'audience',
        approvedBy: 'guest',
        state: 'active',
        generation: 1,
      },
      0,
      workNow,
    );
    assert.match(
      JSON.stringify(await workTaskPicker(db, { notion, discord }, input, context)),
      /Prepare agenda/,
    );
    task.properties.Project.relation = [{ id: taskId }];
    assert.doesNotMatch(
      JSON.stringify(await workTaskPicker(db, { notion, discord }, input, context)),
      /Prepare agenda/,
    );
  } finally {
    db.raw.close();
  }
});
