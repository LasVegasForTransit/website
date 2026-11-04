import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb, seedActiveWorkRoute } from './support/db';
import { findActiveWorkRoute, readWorkRoute, saveWorkRoute } from '../src/discord-work-routes';
import { readProjectHome, saveProjectHome } from '../src/discord-work-links';

const scope = {
  environment: 'preview' as const,
  guildId: '222222222222222222',
  workspaceId: 'workspace',
};
const now = new Date('2026-10-22T12:00:00Z');
const actor = { personId: 'person' };
const route = {
  id: 'events',
  scope,
  sourceId: '380c7791-208f-80b2-9868-000bc287f878',
  kind: 'event' as const,
  state: 'active' as const,
  revision: 1,
  trigger: { property: 'Status', values: ['Planning'] },
  destination: { kind: 'text' as const, channelId: '333333333333333333' },
  approvedBy: 'person',
  audienceFingerprint: 'approved-audience',
};

void test('routes reject overlapping active sources, fence edits and preserve existing links', async () => {
  const db = memoryDb();
  try {
    db.raw
      .prepare(
        "INSERT INTO people(id,membership_status,created_at,updated_at) VALUES('person','member',?,?)",
      )
      .run(now.toISOString(), now.toISOString());
    assert.equal(
      await saveWorkRoute(db, actor, { route: route, expected: 0 }, now),
      false,
      'a member cannot configure routes',
    );
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('person','person',?)",
      )
      .run(now.toISOString());
    const home = {
      id: 'existing-home',
      scope,
      projectSourceId: 'projects',
      projectId: 'project',
      destination: { kind: 'forum' as const, channelId: '333333333333333333', parentId: null },
      taskParent: null,
      audienceFingerprint: 'audience',
      approvedBy: 'person',
      state: 'active' as const,
      generation: 1,
    };
    assert.equal(await saveProjectHome(db, home, 0, now), true);
    assert.equal(
      await saveWorkRoute(
        db,
        actor,
        { route: { ...route, approvedBy: 'another' }, expected: 0 },
        now,
      ),
      false,
    );
    assert.equal(
      await saveWorkRoute(db, actor, { route: route, expected: 0 }, now),
      false,
      'new routes cannot bypass baseline activation',
    );
    seedActiveWorkRoute(db, route, now);
    assert.throws(
      () =>
        db.raw
          .prepare(
            `INSERT INTO discord_work_routes(id,scope_key,source_id,state,revision,data_json,updated_at)
      SELECT 'duplicate-spelling',scope_key,upper(replace(source_id,'-','')),state,revision,data_json,updated_at FROM discord_work_routes WHERE id='events'`,
          )
          .run(),
      /UNIQUE constraint failed/,
    );
    assert.equal(
      db.raw
        .prepare(
          "SELECT count(*) AS count FROM staff_audits WHERE action='discord_work.configure_route'",
        )
        .get()?.count,
      0,
    );
    assert.equal(
      (await findActiveWorkRoute(db, scope, route.sourceId.replaceAll('-', '')))?.id,
      'events',
    );
    assert.equal(
      await saveWorkRoute(
        db,
        actor,
        {
          route: { ...route, id: 'overlap', sourceId: route.sourceId.replaceAll('-', '') },
          expected: 0,
        },
        now,
      ),
      false,
    );
    assert.equal(
      await saveWorkRoute(
        db,
        actor,
        { route: { ...route, id: 'draft', state: 'paused' }, expected: 0 },
        now,
      ),
      true,
    );
    assert.equal(
      await saveWorkRoute(
        db,
        actor,
        { route: { ...route, id: 'draft', revision: 2 }, expected: 1 },
        now,
      ),
      false,
    );
    assert.equal(
      await saveWorkRoute(
        db,
        actor,
        { route: { ...route, state: 'paused', revision: 2 }, expected: 1 },
        now,
      ),
      true,
    );
    assert.equal(
      await saveWorkRoute(
        db,
        actor,
        { route: { ...route, id: 'draft', revision: 2 }, expected: 1 },
        now,
      ),
      false,
    );
    seedActiveWorkRoute(db, { ...route, id: 'draft', revision: 2 }, now);
    assert.equal(
      await saveWorkRoute(
        db,
        actor,
        { route: { ...route, state: 'active', revision: 2 }, expected: 1 },
        now,
      ),
      false,
    );
    assert.equal((await readWorkRoute(db, scope, 'events'))?.state, 'paused');
    assert.equal((await readProjectHome(db, scope, home.id))?.state, 'active');
    assert.equal((await findActiveWorkRoute(db, scope, route.sourceId))?.id, 'draft');
    db.raw
      .prepare(
        "INSERT INTO people(id,membership_status,created_at,updated_at) VALUES('backup','member',?,?)",
      )
      .run(now.toISOString(), now.toISOString());
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('backup','person',?)",
      )
      .run(now.toISOString());
    db.raw.prepare("DELETE FROM staff_administrators WHERE person_id='person'").run();
    const count = db.raw
      .prepare(
        "SELECT count(*) AS count FROM staff_audits WHERE action='discord_work.configure_route'",
      )
      .get()?.count;
    assert.equal(
      await saveWorkRoute(
        db,
        actor,
        { route: { ...route, id: 'draft', state: 'paused', revision: 3 }, expected: 2 },
        now,
      ),
      false,
    );
    assert.equal((await readWorkRoute(db, scope, 'draft'))?.state, 'active');
    assert.equal(
      db.raw
        .prepare(
          "SELECT count(*) AS count FROM staff_audits WHERE action='discord_work.configure_route'",
        )
        .get()?.count,
      count,
    );
    assert.equal(
      await readWorkRoute(db, { ...scope, guildId: '444444444444444444' }, 'events'),
      null,
    );
  } finally {
    db.raw.close();
  }
});

void test('a paused forum route stores a validated Notion-to-tag mapping only for an administrator', async () => {
  const db = memoryDb();
  try {
    db.raw
      .prepare(
        "INSERT INTO people(id,membership_status,created_at,updated_at) VALUES('person','member',?,?)",
      )
      .run(now.toISOString(), now.toISOString());
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('person','person',?)",
      )
      .run(now.toISOString());
    const draft = {
      ...route,
      id: 'tag-route',
      state: 'paused' as const,
      destination: { kind: 'forum' as const, channelId: '333333333333333333' },
      tagSync: {
        property: 'Stage',
        mappings: [
          { value: 'Planning', tagName: 'Planning' },
          { value: 'Ready', tagName: 'Ready' },
        ],
      },
    };
    assert.equal(await saveWorkRoute(db, actor, { route: draft, expected: 0 }, now), true);
    assert.deepEqual((await readWorkRoute(db, scope, draft.id))?.tagSync, draft.tagSync);
    assert.equal(
      await saveWorkRoute(
        db,
        actor,
        { route: { ...draft, id: 'text-route', destination: route.destination }, expected: 0 },
        now,
      ),
      false,
    );
    assert.equal(
      await saveWorkRoute(
        db,
        actor,
        {
          route: {
            ...draft,
            id: 'invalid-route',
            tagSync: {
              ...draft.tagSync,
              mappings: [
                { value: 'Planning', tagName: 'A' },
                { value: 'Planning', tagName: 'B' },
              ],
            },
          },
          expected: 0,
        },
        now,
      ),
      false,
    );
    assert.equal(await readWorkRoute(db, scope, 'invalid-route'), null);
  } finally {
    db.raw.close();
  }
});
