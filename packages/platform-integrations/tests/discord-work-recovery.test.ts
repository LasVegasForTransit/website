import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enqueueWorkOperation,
  claimWorkOperation,
  settleWorkOperation,
  readWorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { recoverOneWorkOperation } from '../src/discord-work-recovery';
import { DiscordWorkClient } from '../src/discord-work-provider';
import {
  workFixture,
  workScope,
  workNow,
  sourceId,
  projectSourceId,
  projectId,
  discordUserId,
} from './support/discord-work';
void test('an uncertain overview preserves its forum checkpoint and needs positive post evidence before resuming', async () => {
  const { db, notion } = workFixture();
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  const forumId = '333333333333333333';
  let proof: { forumId: string; threadId?: string; starterMessageId?: string } = { forumId };
  Object.assign(discord, { discoverWork: () => Promise.resolve(proof) });
  let now = workNow;
  const context = { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => now };
  try {
    await enqueueWorkOperation(
      db,
      {
        id: 'creation',
        scope: workScope,
        homeId: null,
        conversationId: null,
        generation: 1,
        kind: 'provision',
        sourceKey: 'setup:creation',
        actorPersonId: 'guest',
        actorDiscordId: discordUserId,
        originalAuthorId: discordUserId,
        grantVersion: 'grant',
        payload: {
          intent: 'home',
          linkId: 'home',
          createForum: true,
          destinationId: '777777777777777777',
          subject: { kind: 'project_plan', sourceId: projectSourceId, pageId: projectId },
        },
      },
      now,
    );
    const op = await claimWorkOperation(db, workScope, now);
    assert.ok(op);
    db.raw
      .prepare('UPDATE discord_work_operations SET result_json=? WHERE id=?')
      .run(JSON.stringify({ forumId }), op.id);
    await settleWorkOperation(db, { id: op.id, token: op.claim_token }, { state: 'held' }, now);
    assert.equal(
      (
        JSON.parse((await readWorkOperation(db, workScope, op.id))?.result_json ?? '{}') as {
          forumId?: string;
        }
      ).forumId,
      forumId,
    );
    now = new Date(now.getTime() + 60_001);
    assert.equal((await recoverOneWorkOperation(db, { discord, notion }, context)).kind, 'paused');
    assert.equal((await readWorkOperation(db, workScope, op.id))?.state, 'held');
    proof = { forumId, threadId: '555555555555555555', starterMessageId: '555555555555555555' };
    now = new Date(now.getTime() + 300_001);
    assert.equal(
      (await recoverOneWorkOperation(db, { discord, notion }, context)).kind,
      'progress',
    );
    assert.equal((await readWorkOperation(db, workScope, op.id))?.state, 'queued');
  } finally {
    db.raw.close();
  }
});
