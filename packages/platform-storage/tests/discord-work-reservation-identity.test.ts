import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMigrations, memoryDb } from './support/db';
import { enqueueWorkOperation } from '../src/discord-work-operations';

void test('concurrent provisioning reserves a Notion subject across equivalent UUID spellings', async () => {
  const db = memoryDb();
  const now = new Date('2026-10-22T12:00:00.000Z');
  const subject = {
    kind: 'project_plan',
    sourceId: '10000000-0000-4000-8000-000000000003',
    pageId: '10000000-0000-4000-8000-000000000004',
  };
  const operation = {
    id: 'first',
    scope: {
      environment: 'preview' as const,
      guildId: '222222222222222222',
      workspaceId: 'workspace',
    },
    homeId: null,
    conversationId: null,
    generation: 1,
    kind: 'provision' as const,
    sourceKey: 'first',
    actorPersonId: null,
    actorDiscordId: '111111111111111111',
    grantVersion: 'grant',
    originalAuthorId: '111111111111111111',
    payload: { subject },
  };
  try {
    assert.equal(await enqueueWorkOperation(db, operation, now), 'queued');
    const second = {
      ...operation,
      id: 'second',
      sourceKey: 'second',
      payload: {
        subject: {
          ...subject,
          sourceId: subject.sourceId.replaceAll('-', '').toUpperCase(),
          pageId: subject.pageId.replaceAll('-', ''),
        },
      },
    };
    assert.notEqual(await enqueueWorkOperation(db, second, now), 'queued');
    assert.equal(
      db.raw
        .prepare(
          "SELECT count(*) AS n FROM discord_work_operations WHERE kind='provision' AND state='queued'",
        )
        .get()?.n,
      1,
    );
  } finally {
    db.raw.close();
  }
});

void test('the reservation migration preserves conflicting pending operations for review', async () => {
  const db = memoryDb('0062_discord_work_comment_identity.sql');
  const now = new Date('2026-10-22T12:00:00.000Z');
  const subject = {
    kind: 'project_plan',
    sourceId: '10000000-0000-4000-8000-000000000003',
    pageId: '10000000-0000-4000-8000-000000000004',
  };
  const operation = {
    id: 'first',
    scope: {
      environment: 'preview' as const,
      guildId: '222222222222222222',
      workspaceId: 'workspace',
    },
    homeId: null,
    conversationId: null,
    generation: 1,
    kind: 'provision' as const,
    sourceKey: 'first',
    actorPersonId: null,
    actorDiscordId: '111111111111111111',
    grantVersion: 'grant',
    originalAuthorId: '111111111111111111',
    payload: { subject },
  };
  try {
    assert.equal(await enqueueWorkOperation(db, operation, now), 'queued');
    assert.equal(
      await enqueueWorkOperation(
        db,
        {
          ...operation,
          id: 'second',
          sourceKey: 'second',
          payload: { subject: { ...subject, pageId: subject.pageId.replaceAll('-', '') } },
        },
        now,
      ),
      'queued',
    );
    assert.throws(() => applyMigrations(db.raw), /UNIQUE constraint failed/);
    assert.equal(
      db.raw
        .prepare(
          "SELECT count(*) AS n FROM discord_work_operations WHERE kind='provision' AND state='queued'",
        )
        .get()?.n,
      2,
    );
  } finally {
    db.raw.close();
  }
});
