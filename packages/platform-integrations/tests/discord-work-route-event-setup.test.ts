import assert from 'node:assert/strict';
import test from 'node:test';
import { DiscordWorkClient } from '../src/discord-work-provider';
import { runWorkPreview } from '../src/discord-work-setup';
import { runWorkRouteScan } from '../src/discord-work-route-scan';
import { discordUserId, sourceId, workFixture, workNow, workScope } from './support/discord-work';

void test('an administrator can choose a source and status for an events channel without entering IDs', async () => {
  const { db, notion } = workFixture();
  const discord = new DiscordWorkClient({
    guildId: workScope.guildId,
    applicationId: '444444444444444444',
    botToken: 'fixture-only',
  });
  Object.assign(notion, {
    queryWorkSource: () => Promise.resolve({ results: [], nextCursor: null }),
    searchDataSources: () =>
      Promise.resolve({
        results: [{ object: 'data_source', id: sourceId, title: [{ plain_text: 'Events' }] }],
        nextCursor: null,
      }),
    readDataSource: () =>
      Promise.resolve({
        object: 'data_source',
        id: sourceId,
        title: [{ plain_text: 'Events' }],
        properties: {
          Status: {
            type: 'status',
            status: {
              options: [
                { name: 'Planning' },
                { name: 'Pending review' },
                { name: 'Registration open' },
              ],
            },
          },
        },
      }),
  });
  Object.assign(discord, {
    membership: () => Promise.resolve(true),
    inspectDestination: () =>
      Promise.resolve({
        isCategory: false,
        destination: { kind: 'text', channelId: '333333333333333333', parentId: null },
        audienceFingerprint: 'audience',
        archived: false,
        locked: false,
        canRead: true,
        canSend: true,
        canCreateThreads: true,
        canManageChannels: false,
        requiredTag: false,
        tags: [],
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
  const content = (value: unknown) => JSON.stringify(value);
  try {
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id='guest'").run();
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('guest','setup',?)",
      )
      .run(workNow.toISOString());
    const first = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-event', destinationId: base.channelId } },
      context,
    );
    assert.match(content(first), /Events/);
    const receipt = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route-setup'",
      )
      .get();
    assert.ok(receipt);
    const linkId = String(receipt.id);
    const second = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-source', linkId, value: sourceId } },
      context,
    );
    assert.match(content(second), /Planning/);
    assert.match(content(second), /"max_values":3/);
    const third = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-choice', linkId, values: ['0', '1', '2'] } },
      context,
    );
    assert.match(content(third), /Planning/);
    assert.match(content(third), /Pending review/);
    assert.match(content(third), /Registration open/);
    const approval = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route'",
      )
      .get();
    assert.ok(approval);
    const done = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-approve', linkId: String(approval.id) } },
      context,
    );
    assert.match(content(done), /paused/i);
    assert.equal(db.raw.prepare('SELECT state FROM discord_work_routes').get()?.state, 'paused');
    assert.deepEqual(
      (
        JSON.parse(
          String(db.raw.prepare('SELECT data_json FROM discord_work_routes').get()?.data_json),
        ) as { trigger: { values: string[] } }
      ).trigger.values,
      ['Planning', 'Pending review', 'Registration open'],
    );
    const routes = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'routes' } },
      context,
    );
    assert.match(content(routes), /Events/);
    assert.match(content(routes), /Planning/);
    assert.match(content(routes), /Paused/);
    assert.match(content(routes), /Edit a route/);
    const listReceipt = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route-list'",
      )
      .get();
    const savedRoute = db.raw.prepare('SELECT id FROM discord_work_routes').get();
    assert.ok(listReceipt && savedRoute);
    const editId = String(listReceipt.id);
    const edit = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-edit', linkId: editId, value: String(savedRoute.id) } },
      context,
    );
    assert.match(content(edit), /Choose a destination/);
    const chooseDestination = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-dest', linkId: editId, value: base.channelId } },
      context,
    );
    assert.match(content(chooseDestination), /Events/);
    await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-source', linkId: editId, value: sourceId } },
      context,
    );
    const reviewEdit = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-choice', linkId: editId, value: '0' } },
      context,
    );
    assert.match(content(reviewEdit), /Planning/);
    const editApproval = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route' AND json_extract(payload_json,'$.input.expectedRevision')=1",
      )
      .get();
    assert.ok(editApproval);
    await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-approve', linkId: String(editApproval.id) } },
      context,
    );
    assert.equal(
      db.raw
        .prepare('SELECT revision FROM discord_work_routes WHERE id=?')
        .get(String(savedRoute.id))?.revision,
      2,
    );
    await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'routes' } },
      context,
    );
    const managerList = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route-list'",
      )
      .get();
    assert.ok(managerList);
    db.raw
      .prepare(
        "INSERT INTO discord_work_route_scans(route_id,scope_key,revision,mode,last_error,next_attempt_at,updated_at) VALUES(?,?,2,'baseline','source_unavailable',?,?)",
      )
      .run(
        String(savedRoute.id),
        JSON.stringify([workScope.environment, workScope.guildId, workScope.workspaceId]),
        workNow.toISOString(),
        workNow.toISOString(),
      );
    db.raw
      .prepare(
        "INSERT INTO discord_work_requests(id,scope_key,source_id,page_id,route_id,route_revision,state,reason,created_at) VALUES(?,?,?,?,?,2,'held','audience_or_permission_changed',?)",
      )
      .run(
        'held-request',
        JSON.stringify([workScope.environment, workScope.guildId, workScope.workspaceId]),
        sourceId.replaceAll('-', ''),
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        String(savedRoute.id),
        workNow.toISOString(),
      );
    const manage = await runWorkPreview(
      db,
      { notion, discord },
      {
        ...base,
        intent: {
          action: 'route-manage',
          linkId: String(managerList.id),
          value: String(savedRoute.id),
        },
      },
      context,
    );
    assert.match(content(manage), /Prepare/);
    assert.match(content(manage), /Requests needing attention/);
    assert.match(content(manage), /aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
    assert.match(content(manage), /bot permissions/);
    assert.match(content(manage), /Notion scan interrupted/);
    const manager = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route-manage'",
      )
      .get();
    assert.ok(manager);
    const beforeBaseline = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-enable', linkId: String(manager.id) } },
      context,
    );
    assert.match(content(beforeBaseline), /prepar/i);
    const prepare = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-prepare', linkId: String(manager.id) } },
      context,
    );
    assert.match(content(prepare), /prepar/i);
    assert.equal((await runWorkRouteScan(db, notion, workScope, () => workNow)).kind, 'progress');
    const reviewActivation = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-enable', linkId: String(manager.id) } },
      context,
    );
    assert.match(content(reviewActivation), /existing/i);
    const activation = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route-activation'",
      )
      .get();
    assert.ok(activation);
    const originalInspection = discord.inspectDestination.bind(discord);
    Object.assign(discord, {
      inspectDestination: async () => ({
        ...(await originalInspection(base.channelId)),
        audienceFingerprint: 'changed',
      }),
    });
    const staleActivation = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-enable-confirm', linkId: String(activation.id) } },
      context,
    );
    assert.match(content(staleActivation), /changed/i);
    assert.equal(
      db.raw.prepare('SELECT state FROM discord_work_routes WHERE id=?').get(String(savedRoute.id))
        ?.state,
      'paused',
    );
    Object.assign(discord, { inspectDestination: originalInspection });
    const enabled = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-enable-confirm', linkId: String(activation.id) } },
      context,
    );
    assert.match(content(enabled), /active/i);
    assert.equal(
      db.raw.prepare('SELECT state FROM discord_work_routes WHERE id=?').get(String(savedRoute.id))
        ?.state,
      'active',
    );
    db.raw
      .prepare("UPDATE discord_work_requests SET route_revision=3 WHERE id='held-request'")
      .run();
    await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'routes' } },
      context,
    );
    const activeList = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route-list' ORDER BY rowid DESC LIMIT 1",
      )
      .get();
    assert.ok(activeList);
    await runWorkPreview(
      db,
      { notion, discord },
      {
        ...base,
        intent: {
          action: 'route-manage',
          linkId: String(activeList.id),
          value: String(savedRoute.id),
        },
      },
      context,
    );
    const activeManager = db.raw
      .prepare(
        "SELECT id FROM discord_work_operations WHERE state='preview' AND json_extract(payload_json,'$.intent')='route-manage' ORDER BY rowid DESC LIMIT 1",
      )
      .get();
    assert.ok(activeManager);
    const retry = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-retry-checks', linkId: String(activeManager.id) } },
      context,
    );
    assert.match(content(retry), /Checks queued/);
    assert.equal(
      db.raw.prepare("SELECT state FROM discord_work_requests WHERE id='held-request'").get()
        ?.state,
      'pending',
    );
    const paused = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'route-pause', linkId: String(activeManager.id) } },
      context,
    );
    assert.match(content(paused), /paused/i);
    assert.equal(
      db.raw.prepare('SELECT state FROM discord_work_routes WHERE id=?').get(String(savedRoute.id))
        ?.state,
      'paused',
    );
    const otherScope = { ...workScope, workspaceId: 'another-workspace' };
    const isolated = await runWorkPreview(
      db,
      { notion, discord },
      { ...base, intent: { action: 'routes' } },
      { ...context, scope: otherScope },
    );
    assert.doesNotMatch(content(isolated), /Events/);
  } finally {
    db.raw.close();
  }
});
