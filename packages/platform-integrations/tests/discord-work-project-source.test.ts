import assert from 'node:assert/strict';
import test from 'node:test';
import { workScopeKey } from '@lasvegasfortransit/platform-storage/discord-work-types';
import {
  saveProjectHome,
  findProjectHomesForPlacement,
} from '@lasvegasfortransit/platform-storage/discord-work-links';
import { projectRouteSourceMatches } from '../src/discord-work-route-preview';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { runWorkPreview } from '../src/discord-work-setup';
import { sourceSubject } from '../src/discord-work-setup-links';
import {
  discordUserId,
  sourceId,
  projectSourceId,
  workFixture,
  workNow,
  workScope,
} from './support/discord-work';

void test('an administrator can select a discovered project source before approving its route', async () => {
  const { db, notion } = workFixture();
  const independentSource = '10000000-0000-4000-8000-000000000099';
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  Object.assign(discord, {
    membership: () => Promise.resolve(true),
    communityEnabled: () => Promise.resolve(true),
    inspectDestination: () =>
      Promise.resolve({
        isCategory: true,
        destination: { kind: 'forum', channelId: '333333333333333333', parentId: null },
        audienceFingerprint: 'audience',
        archived: false,
        locked: false,
        canRead: true,
        canSend: false,
        canManageChannels: true,
        requiredTag: false,
        tags: [],
      }),
  });
  Object.assign(notion, {
    searchDataSources: () =>
      Promise.resolve({
        results: [
          { object: 'data_source', id: independentSource, title: [{ plain_text: 'Projects' }] },
        ],
        nextCursor: null,
      }),
    readDataSource: () =>
      Promise.resolve({
        object: 'data_source',
        id: independentSource,
        properties: {
          Status: { type: 'status', status: { options: [{ name: 'In progress' }] } },
          Lead: { type: 'people', people: {} },
        },
      }),
  });
  const context = { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => workNow };
  const base = {
    applicationId: '444444444444444444',
    guildId: workScope.guildId,
    discordUserId,
    channelId: '333333333333333333',
    interactionId: '777777777777777777',
  };
  try {
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
      )
      .run(workNow.toISOString());
    await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-project' } },
      context,
    );
    const receipt = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route-setup'",
      )
      .get();
    assert.ok(receipt);
    const result = await runWorkPreview(
      db,
      { notion, discord },
      {
        ...base,
        intent: { action: 'route-source', linkId: String(receipt.id), value: independentSource },
      },
      context,
    );
    assert.match(JSON.stringify(result), /Status: In progress/);
    const leadChoice = await runWorkPreview(
      db,
      { notion, discord },
      {
        ...base,
        intent: { action: 'route-choice', linkId: String(receipt.id), values: ['0'] },
      },
      context,
    );
    assert.match(JSON.stringify(leadChoice), /Lead/);
    const review = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-lead', linkId: String(receipt.id), value: 'Lead' } },
      context,
    );
    assert.match(JSON.stringify(review), /Review route/);
    const approval = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route'",
      )
      .get();
    assert.ok(approval);
    await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-approve', linkId: String(approval.id) } },
      context,
    );
    const saved = db.raw.prepare('SELECT data_json FROM discord_work_routes').get();
    assert.ok(saved);
    const savedRoute = JSON.parse(String(saved.data_json)) as { projectLeadField?: string };
    assert.equal(savedRoute.projectLeadField, 'Lead');
  } finally {
    db.raw.close();
  }
});

void test('an approved project route can use a source independent of private check-in consent', async () => {
  const { db } = workFixture();
  const independentSource = '10000000-0000-4000-8000-000000000099';
  const before = db.raw
    .prepare('SELECT revision, policy_json FROM task_checkin_sources WHERE id=?')
    .get(sourceId);
  try {
    const route = {
      id: 'independent-project-route',
      scope: workScope,
      sourceId: independentSource,
      kind: 'project',
      state: 'active',
      revision: 1,
      trigger: { property: 'Status', values: ['In progress'] },
      destination: { kind: 'category', channelId: '333333333333333333' },
      approvedBy: 'guest',
      audienceFingerprint: 'audience',
      projectLeadField: 'Lead',
    };
    db.raw
      .prepare(
        'INSERT INTO discord_work_routes(id,scope_key,source_id,state,revision,data_json,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        route.id,
        workScopeKey(workScope),
        independentSource.replaceAll('-', ''),
        route.state,
        route.revision,
        JSON.stringify(route),
        workNow.toISOString(),
      );

    assert.equal(await projectRouteSourceMatches(db, workScope, sourceId, independentSource), true);
    assert.deepEqual(
      db.raw
        .prepare('SELECT revision, policy_json FROM task_checkin_sources WHERE id=?')
        .get(sourceId),
      before,
    );
    assert.equal(
      await projectRouteSourceMatches(
        db,
        { ...workScope, guildId: '999999999999999999' },
        sourceId,
        independentSource,
      ),
      false,
    );
  } finally {
    db.raw.close();
  }
});

void test('project lead authorization follows the active project route and fails closed when paused', async () => {
  const { db, notion, project, task } = workFixture();
  const { authorizeWork } = await import('../src/discord-work-authority');
  const independentSource = '10000000-0000-4000-8000-000000000099';
  project.parent.data_source_id = independentSource;
  Object.assign(project.properties.Lead, { people: [{ id: 'notion-guest' }] });
  const route = {
    id: 'independent-project-route',
    scope: workScope,
    sourceId: independentSource,
    kind: 'project',
    state: 'active',
    revision: 1,
    trigger: { property: 'Status', values: ['In progress'] },
    destination: { kind: 'category', channelId: '333333333333333333' },
    approvedBy: 'guest',
    audienceFingerprint: 'audience',
    projectLeadField: 'Lead',
  };
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  Object.assign(discord, { membership: () => Promise.resolve(true) });
  const providers = { notion, discord };
  const input = {
    scope: workScope,
    taskSourceId: sourceId,
    discordUserId,
    subject: { kind: 'project_plan' as const, sourceId: independentSource, pageId: project.id },
    action: 'comment' as const,
  };
  try {
    db.raw
      .prepare(
        'INSERT INTO discord_work_routes(id,scope_key,source_id,state,revision,data_json,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        route.id,
        workScopeKey(workScope),
        independentSource.replaceAll('-', ''),
        route.state,
        route.revision,
        JSON.stringify(route),
        workNow.toISOString(),
      );
    assert.equal((await authorizeWork(db, providers, input, workNow))?.personId, 'guest');
    assert.equal(
      (await authorizeWork(db, providers, { ...input, taskSourceId: 'missing' }, workNow))
        ?.personId,
      'guest',
    );
    const linked = await sourceSubject(db, providers, project.id, {
      scope: workScope,
      taskSourceId: sourceId,
      enabled: true,
      clock: () => workNow,
    });
    assert.equal(linked?.subject.kind, 'project_plan');
    await saveProjectHome(
      db,
      {
        id: 'independent-home',
        scope: workScope,
        projectSourceId: independentSource,
        projectId: project.id,
        destination: { kind: 'forum', channelId: '333333333333333333', parentId: null },
        taskParent: null,
        audienceFingerprint: 'audience',
        approvedBy: 'guest',
        state: 'active',
        generation: 1,
      },
      0,
      workNow,
    );
    task.properties.Assignee.people = [];
    const taskInput = {
      ...input,
      homeId: 'independent-home',
      subject: { kind: 'task' as const, sourceId, pageId: task.id },
      action: 'place_work' as const,
    };
    assert.equal(
      (
        await findProjectHomesForPlacement(db, workScope, {
          projectIds: [project.id],
          channelId: '333333333333333333',
          parentId: null,
        })
      ).length,
      1,
    );
    assert.equal((await authorizeWork(db, providers, taskInput, workNow))?.personId, 'guest');
    db.raw.prepare("UPDATE discord_work_routes SET state='paused' WHERE id=?").run(route.id);
    assert.equal(await authorizeWork(db, providers, input, workNow), null);
    assert.equal(await authorizeWork(db, providers, taskInput, workNow), null);
  } finally {
    db.raw.close();
  }
});

void test('an active route selects its own lead field for an existing projects source', async () => {
  const { db } = workFixture();
  const { readWorkSource, projectLeadConfig } = await import('../src/discord-work-authority');
  try {
    const source = await readWorkSource(db, sourceId, workScope);
    assert.ok(source);
    const route = {
      id: 'project-route',
      scope: workScope,
      sourceId: projectSourceId,
      kind: 'project',
      state: 'active',
      revision: 1,
      projectLeadField: 'Organizer',
      trigger: { property: 'Status', values: ['Planning'] },
      destination: { kind: 'category', channelId: '333333333333333333' },
      approvedBy: 'guest',
      audienceFingerprint: 'audience',
    };
    db.raw
      .prepare(
        'INSERT INTO discord_work_routes(id,scope_key,source_id,state,revision,data_json,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        route.id,
        workScopeKey(workScope),
        projectSourceId.replaceAll('-', ''),
        route.state,
        route.revision,
        JSON.stringify(route),
        workNow.toISOString(),
      );
    assert.equal(
      (await projectLeadConfig(db, workScope, source, projectSourceId))?.field,
      'Organizer',
    );
  } finally {
    db.raw.close();
  }
});
