import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { memoryDb } from './support/db';
import { saveProjectHome } from '../src/discord-work-links';

void test('canonical identity migration stops on existing collisions without discarding links', async () => {
  const db = memoryDb();
  const now = new Date('2026-10-22T12:00:00.000Z');
  const scope = {
    environment: 'preview' as const,
    guildId: '222222222222222222',
    workspaceId: 'workspace',
  };
  const source = '10000000-0000-4000-8000-000000000003',
    project = '10000000-0000-4000-8000-000000000004';
  const home = {
    id: 'first',
    scope,
    projectSourceId: source,
    projectId: project,
    destination: { kind: 'forum' as const, channelId: '333333333333333333', parentId: null },
    taskParent: null,
    audienceFingerprint: 'audience',
    approvedBy: 'person',
    state: 'active' as const,
    generation: 1,
  };
  try {
    db.raw.exec(
      'DROP INDEX discord_work_project_home_canonical; DROP INDEX discord_work_subject_canonical; DROP INDEX discord_work_active_route_source_canonical',
    );
    assert.equal(await saveProjectHome(db, home, 0, now), true);
    assert.equal(
      await saveProjectHome(
        db,
        {
          ...home,
          id: 'second',
          projectSourceId: source.replaceAll('-', ''),
          projectId: project.replaceAll('-', ''),
        },
        0,
        now,
      ),
      true,
    );
    const sql = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../migrations/0061_discord_work_canonical_identity.sql',
      ),
      'utf8',
    );
    db.raw.exec('BEGIN');
    assert.throws(() => db.raw.exec(sql), /UNIQUE constraint failed/);
    db.raw.exec('ROLLBACK');
    assert.equal(
      db.raw.prepare("SELECT count(*) AS n FROM discord_project_homes WHERE state='active'").get()
        ?.n,
      2,
    );
  } finally {
    db.raw.close();
  }
});

void test('comment identity migration stops on duplicate legacy message saves', async () => {
  const { enqueueWorkOperation } = await import('../src/discord-work-operations');
  const db = memoryDb();
  const now = new Date('2026-10-22T12:00:00.000Z');
  const scope = {
    environment: 'preview' as const,
    guildId: '222222222222222222',
    workspaceId: 'workspace',
  };
  const page = '10000000-0000-4000-8000-000000000004';
  try {
    db.raw.exec('DROP INDEX discord_work_comment_source_canonical');
    await saveProjectHome(
      db,
      {
        id: 'home',
        scope,
        projectSourceId: '10000000-0000-4000-8000-000000000003',
        projectId: page,
        destination: { kind: 'text', channelId: '333333333333333333', parentId: null },
        taskParent: null,
        audienceFingerprint: 'audience',
        approvedBy: 'person',
        state: 'active',
        generation: 1,
      },
      0,
      now,
    );
    const operation = {
      id: 'first',
      scope,
      homeId: 'home',
      conversationId: null,
      generation: 1,
      kind: 'comment' as const,
      sourceKey: `comment:${page}:333333333333333333:555555555555555555`,
      actorPersonId: null,
      actorDiscordId: '111111111111111111',
      grantVersion: 'grant',
      originalAuthorId: '111111111111111111',
      payload: {},
    };
    assert.equal(await enqueueWorkOperation(db, operation, now), 'queued');
    assert.equal(
      await enqueueWorkOperation(
        db,
        { ...operation, id: 'second', sourceKey: operation.sourceKey.replaceAll('-', '') },
        now,
      ),
      'queued',
    );
    const sql = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../migrations/0062_discord_work_comment_identity.sql',
      ),
      'utf8',
    );
    db.raw.exec('BEGIN');
    assert.throws(() => db.raw.exec(sql), /UNIQUE constraint failed/);
    db.raw.exec('ROLLBACK');
    assert.equal(
      db.raw.prepare("SELECT count(*) AS n FROM discord_work_operations WHERE kind='comment'").get()
        ?.n,
      2,
    );
  } finally {
    db.raw.close();
  }
});
