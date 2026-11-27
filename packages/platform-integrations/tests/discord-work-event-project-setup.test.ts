import assert from 'node:assert/strict';
import test from 'node:test';
import { saveProjectHome } from '@lasvegasfortransit/platform-storage/discord-work-links';
import { claimWorkOperation } from '@lasvegasfortransit/platform-storage/discord-work-operations';
import { processWorkRouteRequest } from '../src/discord-work-route-requests';
import { processWorkProvision } from '../src/discord-work-provision';
import { processWorkAction } from '../src/discord-work-actions';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { runWorkPreview } from '../src/discord-work-setup';
import { runWorkRouteScan } from '../src/discord-work-route-scan';
import {
  discordUserId,
  sourceId,
  projectSourceId,
  projectId,
  workFixture,
  workNow,
  workScope,
} from './support/discord-work';

void test('an admin configures and activates a project-linked event route using a verified relation', async () => {
  const { db, notion } = workFixture();
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  let target = projectSourceId,
    sourceUnavailable = false;
  Object.assign(notion, {
    searchDataSources: () =>
      Promise.resolve({
        results: [{ object: 'data_source', id: sourceId, title: [{ plain_text: 'Events' }] }],
        nextCursor: null,
      }),
    readDataSource: () =>
      sourceUnavailable
        ? Promise.reject(new Error('unavailable'))
        : Promise.resolve({
            object: 'data_source',
            id: sourceId,
            title: [{ plain_text: 'Events' }],
            properties: {
              Status: {
                type: 'status',
                status: { options: [{ name: 'Planning' }, { name: 'Pending review' }] },
              },
              Project: { id: 'rel', type: 'relation', relation: { data_source_id: target } },
            },
          }),
    queryWorkSource: () => Promise.resolve({ results: [], nextCursor: null }),
  });
  Object.assign(discord, {
    membership: () => Promise.resolve(true),
    inspectDestination: () =>
      Promise.resolve({
        isCategory: true,
        destination: { kind: 'forum', channelId: '333333333333333333', parentId: null },
        audienceFingerprint: 'audience',
        canRead: true,
        canSend: false,
        canCreateThreads: false,
        canManageChannels: true,
        archived: false,
        locked: false,
        requiredTag: false,
        tags: [],
      }),
  });
  const base = {
    applicationId: '444444444444444444',
    guildId: workScope.guildId,
    discordUserId,
    channelId: '333333333333333333',
    interactionId: '777777777777777777',
  };
  const context = { scope: workScope, taskSourceId: sourceId, enabled: true, clock: () => workNow };
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
      { ...base, intent: { action: 'route-event-project', destinationId: base.channelId } },
      context,
    );
    const setup = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route-setup'",
      )
      .get();
    assert.ok(setup);
    const linkId = String(setup.id);
    await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-source', linkId, value: sourceId } },
      context,
    );
    sourceUnavailable = true;
    const unavailable = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-choice', linkId, value: '0' } },
      context,
    );
    assert.match(JSON.stringify(unavailable), /source.*access/i);
    sourceUnavailable = false;
    target = '10000000-0000-4000-8000-000000000099';
    const missing = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-choice', linkId, value: '0' } },
      context,
    );
    assert.match(JSON.stringify(missing), /add.*relation/i);
    const independent = target.replaceAll('-', '');
    const independentRoute = {
      id: 'independent-project',
      scope: workScope,
      sourceId: independent,
      kind: 'project',
      state: 'active',
      revision: 1,
      trigger: { property: 'Status', values: ['Planning'] },
      destination: { kind: 'category', channelId: base.channelId },
      approvedBy: 'guest',
      audienceFingerprint: 'audience',
      projectLeadField: 'Lead',
    };
    db.raw
      .prepare(
        'INSERT INTO discord_work_routes(id,scope_key,source_id,state,revision,data_json,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        independentRoute.id,
        JSON.stringify([workScope.environment, workScope.guildId, workScope.workspaceId]),
        independent,
        independentRoute.state,
        independentRoute.revision,
        JSON.stringify(independentRoute),
        workNow.toISOString(),
      );
    const independentRelation = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-choice', linkId, value: '0' } },
      context,
    );
    assert.match(JSON.stringify(independentRelation), /identifies an event/);
    db.raw.prepare('DELETE FROM discord_work_routes WHERE id=?').run(independentRoute.id);
    target = projectSourceId;
    const relations = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-choice', linkId, values: ['0', '1'] } },
      context,
    );
    assert.match(JSON.stringify(relations), /identifies an event/);
    const review = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-relation', linkId, value: 'rel' } },
      context,
    );
    assert.match(JSON.stringify(review), /Project relation: Project/);
    assert.match(JSON.stringify(review), /Pending review/);
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
    const route = db.raw.prepare('SELECT id,data_json FROM discord_work_routes').get();
    assert.ok(route);
    assert.deepEqual(
      (JSON.parse(String(route.data_json)) as { trigger: { values: string[] } }).trigger.values,
      ['Planning', 'Pending review'],
    );
    assert.deepEqual(
      (JSON.parse(String(route.data_json)) as { projectRelation: unknown }).projectRelation,
      {
        property: 'rel',
        projectSourceId,
      },
    );
    await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'routes' } },
      context,
    );
    const list = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route-list' ORDER BY rowid DESC LIMIT 1",
      )
      .get();
    assert.ok(list);
    await runWorkPreview(
      db,
      { notion, discord },
      {
        ...base,
        intent: { action: 'route-manage', linkId: String(list.id), value: String(route.id) },
      },
      context,
    );
    const manager = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route-manage' ORDER BY rowid DESC LIMIT 1",
      )
      .get();
    assert.ok(manager);
    await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-prepare', linkId: String(manager.id) } },
      context,
    );
    assert.equal((await runWorkRouteScan(db, notion, workScope, () => workNow)).kind, 'progress');
    target = '10000000-0000-4000-8000-000000000099';
    const invalid = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-enable', linkId: String(manager.id) } },
      context,
    );
    assert.match(JSON.stringify(invalid), /changed/i);
    target = projectSourceId;
    const activation = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-enable', linkId: String(manager.id) } },
      context,
    );
    assert.match(JSON.stringify(activation), /Activate/);
    const receipt = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route-activation' ORDER BY rowid DESC LIMIT 1",
      )
      .get();
    assert.ok(receipt);
    const enabled = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-enable-confirm', linkId: String(receipt.id) } },
      context,
    );
    assert.match(JSON.stringify(enabled), /Route active/);

    const forumId = '555555555555555555';
    const threadId = '666666666666666666';
    const eventId = '20000000-0000-4000-8000-000000000002';
    const later = new Date(workNow.getTime() + 120_000);
    const liveContext = { ...context, clock: () => later };
    await saveProjectHome(
      db,
      {
        id: 'project-home',
        scope: workScope,
        projectSourceId,
        projectId,
        destination: { kind: 'forum', channelId: forumId, parentId: base.channelId },
        taskParent: null,
        audienceFingerprint: 'audience',
        approvedBy: 'guest',
        state: 'active',
        generation: 1,
      },
      0,
      workNow,
    );
    const event = {
      object: 'page',
      id: eventId,
      parent: { data_source_id: sourceId },
      created_time: new Date(workNow.getTime() + 1000).toISOString(),
      last_edited_time: new Date(workNow.getTime() + 1000).toISOString(),
      properties: {
        Name: { type: 'title', title: [{ plain_text: 'Event' }] },
        Status: { type: 'status', status: { name: 'Planning' } },
        Project: { id: 'rel', type: 'relation', relation: [{ id: projectId }], has_more: false },
      },
    };
    const blocks: Record<string, unknown>[] = [
      {
        id: 'organizer',
        type: 'paragraph',
        created_by: { id: 'person' },
        paragraph: { rich_text: [{ text: { content: 'Event details' } }] },
      },
    ];
    Object.assign(notion, {
      queryWorkSource: () => Promise.resolve({ results: [event], nextCursor: null }),
      readPage: (id: string) =>
        Promise.resolve(
          id.replaceAll('-', '') === projectId.replaceAll('-', '')
            ? { object: 'page', id: projectId, parent: { data_source_id: projectSourceId } }
            : event,
        ),
      readSelf: () => Promise.resolve({ id: 'bot', type: 'bot' }),
      listBlockChildren: () => Promise.resolve({ results: blocks, nextCursor: null }),
      appendBlockChildren: (_page: string, children: Record<string, unknown>[]) => {
        const added = children.map((block, index) => ({
          ...block,
          id: `block-${index}`,
          created_by: { id: 'bot' },
        }));
        blocks.push(...added);
        return Promise.resolve({ results: added });
      },
    });
    let creates = 0;
    Object.assign(discord, {
      inspectDestination: (id: string) =>
        Promise.resolve({
          isCategory: id === base.channelId,
          destination: {
            kind: id === threadId ? 'thread' : 'forum',
            channelId: id,
            parentId: id === base.channelId ? null : id === threadId ? forumId : base.channelId,
          },
          audienceFingerprint: 'audience',
          canRead: true,
          canSend: true,
          canCreateThreads: false,
          canManageChannels: true,
          archived: false,
          locked: false,
          requiredTag: false,
          tags: [],
        }),
      createTaskConversation: (input: { destination: { destination: { channelId: string } } }) => {
        assert.equal(input.destination.destination.channelId, forumId);
        creates++;
        return Promise.resolve({ threadId, starterMessageId: threadId });
      },
    });
    assert.equal((await runWorkRouteScan(db, notion, workScope, () => later)).kind, 'progress');
    assert.equal(
      (await processWorkRouteRequest(db, { notion, discord }, liveContext)).kind,
      'progress',
    );
    const provision = await claimWorkOperation(db, workScope, later);
    assert.ok(provision);
    assert.equal(
      (await processWorkProvision(db, { notion, discord }, provision, liveContext)).kind,
      'progress',
    );
    const backlink = await claimWorkOperation(db, workScope, later);
    assert.ok(backlink);
    assert.equal(
      (await processWorkAction(db, { notion, discord }, backlink, liveContext)).kind,
      'progress',
    );
    assert.equal(creates, 1);
    assert.deepEqual(
      blocks.map((block) => block.type),
      ['paragraph', 'divider', 'paragraph'],
    );
    assert.match(
      JSON.stringify(blocks[2]),
      new RegExp(`discord\\.com/channels/${workScope.guildId}/${threadId}`),
    );
  } finally {
    db.raw.close();
  }
});
