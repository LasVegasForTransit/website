import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { enqueueWorkOperation } from '../src/discord-work-operations';
import { taskRetentionWrites } from '../src/notion-task-retention';
void test('shared update text expires without losing deduplication, and removing an identity revokes queued work', async () => {
  const db = memoryDb(),
    now = new Date('2026-10-22T12:00:00Z');
  const scope = {
    environment: 'preview' as const,
    guildId: '222222222222222222',
    workspaceId: 'workspace',
  };
  db.raw
    .prepare("INSERT INTO people(id,created_at,updated_at) VALUES('guest',?,?)")
    .run(now.toISOString(), now.toISOString());
  db.raw
    .prepare(
      "INSERT INTO task_checkin_sources(id,workspace_id,revision,enabled,policy_json,updated_at) VALUES('source','workspace',1,0,?,?)",
    )
    .run(JSON.stringify({ retentionDays: 1 }), now.toISOString());
  const input = {
    id: 'preview',
    scope,
    homeId: null,
    conversationId: null,
    generation: 1,
    kind: 'provision' as const,
    sourceKey: 'preview:one',
    actorPersonId: 'guest',
    actorDiscordId: '111111111111111111',
    grantVersion: 'grant',
    originalAuthorId: '111111111111111111',
    payload: { text: 'PRIVATE UPDATE' },
    preview: true,
  };
  try {
    await enqueueWorkOperation(db, input, now);
    await db.batch(await taskRetentionWrites(db, new Date(now.getTime() + 2 * 86_400_000), 25));
    const expired = db.raw
      .prepare('SELECT payload_json,source_key,state FROM discord_work_operations')
      .get();
    assert.equal(expired?.payload_json, '{}');
    assert.equal(expired.source_key, 'preview:one');
    assert.equal(expired.state, 'superseded');
    await enqueueWorkOperation(
      db,
      { ...input, id: 'active', sourceKey: 'setup:two', preview: false },
      now,
    );
    db.raw
      .prepare(
        "INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at) VALUES('identity','guest','discord','111111111111111111',?,'self_linked',?,?)",
      )
      .run(now.toISOString(), now.toISOString(), now.toISOString());
    db.raw.prepare("DELETE FROM identities WHERE id='identity'").run();
    assert.equal(
      db.raw.prepare("SELECT state FROM discord_work_operations WHERE id='active'").get()?.state,
      'superseded',
    );
    assert.equal(
      db.raw.prepare("SELECT payload_json FROM discord_work_operations WHERE id='active'").get()
        ?.payload_json,
      '{}',
    );
  } finally {
    db.raw.close();
  }
});
