import { generateKeyPairSync, sign } from 'node:crypto';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import {
  saveTaskCheckinSource,
  putNotionTaskMapping,
  upsertNotionTaskSnapshot,
} from '@lasvegasfortransit/platform-storage/notion-task-checkins';
import { taskPolicy } from '@lasvegasfortransit/platform-integrations/test-task-policy';
import { onRequestPost } from '../../functions/platform/discord/interactions';

export const sourceId = '10000000-0000-4000-8000-000000000001';
export const applicationId = '111111111111111111',
  guildId = taskPolicy.guildId;
export const userId = '333333333333333333',
  channelId = '444444444444444444',
  messageId = '555555555555555555';
export const now = new Date();
export async function fixture() {
  const db = memoryDb();
  for (const id of ['member', 'staff'])
    db.raw
      .prepare('INSERT INTO people(id,created_at,updated_at) VALUES(?,?,?)')
      .run(id, now.toISOString(), now.toISOString());
  db.raw
    .prepare(
      `INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at)
    VALUES('discord','member','discord',? ,?,'staff_confirmed',?,?)`,
    )
    .run(userId, now.toISOString(), now.toISOString(), now.toISOString());
  await saveTaskCheckinSource(
    db,
    {
      sourceId,
      workspaceId: 'workspace',
      expectedRevision: 0,
      enabled: true,
      policy: taskPolicy,
      actorId: 'staff',
    },
    now,
  );
  await putNotionTaskMapping(
    db,
    {
      workspaceId: 'workspace',
      notionUserId: 'notion-member',
      personId: 'member',
      confirmedBy: 'staff',
    },
    now,
  );
  await upsertNotionTaskSnapshot(
    db,
    {
      sourceId,
      taskId: 'task',
      revision: 'v1',
      sourceEditedAt: now.toISOString(),
      active: true,
      snapshot: {
        title: 'Prepare agenda',
        url: 'https://www.notion.so/10000000000040008000000000000002',
        assigneeIds: ['notion-member'],
        projectIds: [],
        dueDate: '2026-10-23',
        status: 'In progress',
        ineligibleReason: null,
        description: null,
        dueTimeZone: null,
      },
    },
    now,
  );
  const env = {
    PLATFORM_DB: db,
    LVBT_DEPLOYMENT_ENV: 'preview',
    LVBT_TASK_CHECKINS_ENABLED: 'true',
    LVBT_DISCORD_APPLICATION_ID: applicationId,
    LVBT_DISCORD_GUILD_ID: guildId,
    LVBT_DISCORD_PRODUCTION_GUILD_ID: '999999999999999999',
    LVBT_NOTION_TASK_SOURCE_ID: sourceId,
    LVBT_NOTION_TASK_PRODUCTION_SOURCE_ID: '10000000-0000-4000-8000-000000000099',
  };
  async function send(
    payload: Record<string, unknown>,
    timestamp = String(Math.floor(Date.now() / 1000)),
  ) {
    const body = JSON.stringify({ application_id: applicationId, ...payload });
    const pair = generateKeyPairSync('ed25519');
    const hex = (bytes: Uint8Array) =>
      Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    const publicKey = hex(
      new Uint8Array(pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)),
    );
    const signature = hex(
      new Uint8Array(sign(null, new TextEncoder().encode(timestamp + body), pair.privateKey)),
    );
    const request = new Request(
      'https://preview.lasvegasfortransit.org/platform/discord/interactions',
      {
        method: 'POST',
        body,
        headers: { 'X-Signature-Ed25519': signature, 'X-Signature-Timestamp': timestamp },
      },
    );
    return onRequestPost({
      request,
      env: { ...env, LVBT_DISCORD_PUBLIC_KEY: publicKey },
    } as unknown as Parameters<typeof onRequestPost>[0]);
  }
  async function consent() {
    return send({
      type: 3,
      id: '666666666666666666',
      guild_id: guildId,
      member: { user: { id: userId } },
      data: { custom_id: `tcs:${sourceId}:1:active` },
    });
  }
  return { db, send, consent, env };
}
