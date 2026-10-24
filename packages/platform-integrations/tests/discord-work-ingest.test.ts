import {
  claimWorkOperation,
  settleWorkOperation,
} from '@lasvegasfortransit/platform-storage/discord-work-operations';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  saveProjectHome,
  saveWorkConversation,
  readWorkConversation,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { DiscordWorkClient } from '../src/discord-work-provider';
import {
  workFixture,
  workScope,
  workNow,
  sourceId,
  taskId,
  projectId,
  projectSourceId,
  discordUserId,
} from './support/discord-work';
void test('a frozen reply window drains all 63 messages before releasing effects and excludes later arrivals until the next window', async () => {
  const module = await import('../src/discord-work-ingest').catch(() => null);
  assert.ok(module, 'bounded reply ingestion exists');
  const { db, notion, task } = workFixture();
  const base = 555555555555555555n;
  const rows = Array.from({ length: 63 }, (_, i) => ({
    id: String(base + BigInt(i + 1)),
    channelId: String(base),
    authorId: discordUserId,
    authorName: 'Volunteer',
    createdAt: new Date(workNow.getTime() + i).toISOString(),
    text: `Update ${i + 1}`,
    bot: false,
    webhook: false,
    system: false,
    contentAvailable: true,
    attachmentOnly: false,
  }));
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  Object.assign(discord, {
    messageContentAvailable: () => Promise.resolve(true),
    inspectDestination: () =>
      Promise.resolve({
        audienceFingerprint: 'audience',
        canRead: true,
        canSend: true,
        locked: false,
        archived: false,
      }),
    readMessages: (_id: string, q: { after?: string; before?: string }) =>
      Promise.resolve(
        rows
          .filter(
            (m) =>
              (!q.after || BigInt(m.id) > BigInt(q.after)) &&
              (!q.before || BigInt(m.id) < BigInt(q.before)),
          )
          .sort((a, b) => (BigInt(a.id) > BigInt(b.id) ? -1 : 1))
          .slice(0, 25),
      ),
  });
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
    id: 'conversation',
    scope: workScope,
    subject: { kind: 'task' as const, sourceId, pageId: taskId },
    homeId: 'home',
    placementProjectId: projectId,
    threadId: String(base),
    starterMessageId: String(base),
    mode: 'automatic' as const,
    state: 'active' as const,
    generation: 1,
    activationId: String(base),
    cursorId: String(base),
    windowUpperId: null,
    windowBeforeId: null,
    footerBlockIds: [],
  };
  try {
    await saveProjectHome(db, home, 0, workNow);
    await saveWorkConversation(db, c, 0, workNow);
    let elapsed = 0;
    const context = {
      scope: workScope,
      taskSourceId: sourceId,
      enabled: true,
      clock: () => new Date(workNow.getTime() + elapsed++ * 1000),
    };
    await module.ingestWorkConversation(db, { notion, discord }, c.id, context);
    assert.equal((await readWorkConversation(db, workScope, c.id))?.cursorId, String(base));
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM discord_work_operations').get()?.n, 25);
    const firstMessage = rows[0];
    assert.ok(firstMessage);
    rows.push({ ...firstMessage, id: String(base + 64n), text: 'New arrival' });
    await module.ingestWorkConversation(db, { notion, discord }, c.id, context);
    await module.ingestWorkConversation(db, { notion, discord }, c.id, context);
    assert.equal((await readWorkConversation(db, workScope, c.id))?.cursorId, String(base + 63n));
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM discord_work_operations').get()?.n, 63);
    await module.ingestWorkConversation(db, { notion, discord }, c.id, context);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM discord_work_operations').get()?.n, 64);
    await module.ingestWorkConversation(db, { notion, discord }, c.id, context);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM discord_work_operations').get()?.n, 64);
    const first = await claimWorkOperation(db, workScope, new Date(workNow.getTime() + 300_000));
    assert.ok(first);
    assert.equal(
      (JSON.parse(first.payload_json) as { message: { id: string } }).message.id,
      String(base + 1n),
    );
    await settleWorkOperation(
      db,
      { id: first.id, token: first.claim_token },
      { state: 'held' },
      new Date(workNow.getTime() + 300_001),
    );
    assert.equal(
      await claimWorkOperation(db, workScope, new Date(workNow.getTime() + 301_000)),
      null,
      'later comments wait for an uncertain earlier reply',
    );
    task.archived = true;
    assert.equal(
      (await module.ingestWorkConversation(db, { notion, discord }, c.id, context)).kind,
      'paused',
    );
    assert.equal((await readWorkConversation(db, workScope, c.id))?.cursorId, String(base + 64n));
    task.archived = false;
    rows.push({ ...firstMessage, id: String(base + 65n), text: 'Must wait for source access' });
    db.raw.prepare("UPDATE task_checkin_sources SET policy_json='{}'").run();
    assert.equal(
      (await module.ingestWorkConversation(db, { notion, discord }, c.id, context)).kind,
      'paused',
    );
    assert.equal((await readWorkConversation(db, workScope, c.id))?.cursorId, String(base + 64n));
  } finally {
    db.raw.close();
  }
});
