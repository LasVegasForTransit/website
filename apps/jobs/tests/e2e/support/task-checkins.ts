import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare, Response as RuntimeResponse, convertV4MiniflareOptions } from 'miniflare';
import { applyMigrations } from '@lasvegasfortransit/platform-storage/test-db';
import {
  saveTaskCheckinSource,
  putNotionTaskMapping,
} from '@lasvegasfortransit/platform-storage/notion-task-checkins';
import type { Request as RuntimeRequest } from 'miniflare';
import { taskPolicy } from '@lasvegasfortransit/platform-integrations/test-task-policy';

export async function taskRuntime(
  options: {
    sharedWork?: boolean;
    manualUpdatesOnly?: boolean;
    workResponse?: (request: RuntimeRequest, url: URL) => Promise<RuntimeResponse | null>;
  } = {},
) {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const data = await mkdtemp(join(tmpdir(), 'lvbt-task-cross-worker-'));
  const sourceId = '10000000-0000-4000-8000-000000000001';
  const guildId = taskPolicy.guildId;
  const applicationId = '111111111111111111';
  const accounts = [
    {
      person: 'member',
      user: '333333333333333333',
      channel: '444444444444444444',
      message: '555555555555555555',
      task: '10000000-0000-4000-8000-000000000002',
    },
    {
      person: 'guest',
      user: '333333333333333334',
      channel: '444444444444444445',
      message: '555555555555555556',
      task: '10000000-0000-4000-8000-000000000004',
    },
  ];
  const stamp = new Date().toISOString();
  const due = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  const pages = accounts.map((account) => ({
    object: 'page',
    id: account.task,
    parent: { data_source_id: sourceId },
    last_edited_time: stamp,
    url: `https://www.notion.so/${account.task}`,
    properties: {
      'Task name': { title: [{ plain_text: `Private ${account.person} task` }] },
      Assignee: { people: [{ id: `notion-${account.person}` }] },
      'Due date': { date: { start: due } },
      Status: { status: { name: 'In progress' } },
      Project: { relation: [] as { id: string }[] },
    },
  }));
  const sends: { recipient: string; body: Record<string, unknown> }[] = [];
  const comments: Record<string, unknown>[] = [];
  const completions: string[] = [];
  const providerCalls: string[] = [];
  const faults = {
    scan: 'complete' as 'complete' | 'partial' | 'failed',
    blockedUser: null as string | null,
    ambiguousComment: false,
    visibleComments: true,
    beforeDM: null as null | (() => Promise<void>),
  };
  function json(value: unknown) {
    return new RuntimeResponse(JSON.stringify(value), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  async function queryResponse(request: RuntimeRequest) {
    if (faults.scan === 'failed') return new RuntimeResponse(null, { status: 503 });
    const body = (await request.json()) as { start_cursor?: string };
    return json({
      results:
        faults.scan === 'partial' ? pages.slice(0, 1) : body.start_cursor ? pages.slice(1) : pages,
      next_cursor: faults.scan === 'partial' ? 'remaining-page' : null,
      has_more: faults.scan === 'partial',
    });
  }
  async function notionResponse(request: RuntimeRequest, url: URL) {
    assert.equal(request.headers.get('Authorization'), 'Bearer fixture-only');
    assert.equal(request.headers.get('Notion-Version'), '2025-09-03');
    if (url.pathname === `/v1/data_sources/${sourceId}/query`) return queryResponse(request);
    if (url.pathname === '/v1/users/me') return json({ type: 'bot', id: 'fixture-bot' });
    if (url.pathname === '/v1/comments' && request.method === 'GET')
      return json({
        results: faults.visibleComments ? comments : [],
        next_cursor: null,
        has_more: false,
      });
    if (url.pathname === '/v1/comments' && request.method === 'POST') {
      const body = (await request.json()) as Record<string, unknown>;
      const comment = {
        ...body,
        id: `comment-${comments.length + 1}`,
        object: 'comment',
        created_by: { id: 'fixture-bot' },
      };
      comments.push(comment);
      return faults.ambiguousComment ? new RuntimeResponse(null, { status: 504 }) : json(comment);
    }
    const page = pages.find((item) => url.pathname === `/v1/pages/${item.id}`);
    assert.ok(page, `unexpected Notion route ${request.method} ${url.pathname}`);
    if (request.method === 'PATCH') {
      const body = await request.json();
      assert.deepEqual(body, { properties: { Status: { status: { name: 'Done' } } } });
      completions.push(page.id);
      page.properties.Status.status.name = 'Done';
    }
    return json(page);
  }
  async function discordResponse(request: RuntimeRequest, url: URL) {
    assert.equal(url.origin, 'https://discord.com');
    assert.equal(request.headers.get('Authorization'), 'Bot fixture-only');
    const account = accounts.find(
      (item) => url.pathname === `/api/v10/guilds/${guildId}/members/${item.user}`,
    );
    if (account)
      return json({
        user: { id: account.user, username: account.person },
        roles: [],
        pending: false,
      });
    if (url.pathname === '/api/v10/users/@me/channels') {
      const body = (await request.json()) as { recipient_id: string };
      const target = accounts.find((item) => item.user === body.recipient_id);
      assert.ok(target);
      if (faults.blockedUser === target.user)
        return new RuntimeResponse(JSON.stringify({ code: 50007 }), { status: 403 });
      const beforeDM = faults.beforeDM;
      faults.beforeDM = null;
      await beforeDM?.();
      return json({ id: target.channel, type: 1, recipients: [{ id: target.user }] });
    }
    const target = accounts.find(
      (item) => url.pathname === `/api/v10/channels/${item.channel}/messages`,
    );
    assert.ok(target, `unexpected Discord route ${request.method} ${url.pathname}`);
    assert.equal(request.method, 'POST');
    const body = (await request.json()) as Record<string, unknown>;
    assert.deepEqual(body.allowed_mentions, { parse: [] });
    assert.equal(body.enforce_nonce, true);
    assert.ok(Number(body.flags) & 32768, 'native Components V2');
    sends.push({ recipient: target.user, body });
    return json({ id: target.message, channel_id: target.channel, nonce: body.nonce });
  }
  const common = {
    LVBT_DEPLOYMENT_ENV: 'preview',
    LVBT_TASK_CHECKINS_ENABLED: options.manualUpdatesOnly ? 'false' : 'true',
    LVBT_TASK_UPDATES_ENABLED: options.manualUpdatesOnly ? 'true' : 'false',
    LVBT_DISCORD_WORK_ENABLED: options.sharedWork ? 'true' : 'false',
    LVBT_DISCORD_APPLICATION_ID: applicationId,
    LVBT_DISCORD_GUILD_ID: guildId,
    LVBT_DISCORD_PRODUCTION_GUILD_ID: '999999999999999999',
    LVBT_NOTION_TASK_SOURCE_ID: sourceId,
    LVBT_NOTION_TASK_PRODUCTION_SOURCE_ID: '10000000-0000-4000-8000-000000000099',
  };
  const keys = generateKeyPairSync('ed25519');
  const hex = (bytes: Uint8Array) =>
    Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const publicKey = hex(keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
  const simulator = new Miniflare(
    convertV4MiniflareOptions({
      resourcePersistencePath: data,
      cf: false,
      telemetry: { enabled: false },
      workers: [
        {
          name: 'lvbt-task-site',
          modules: true,
          modulesRoot: join(root, '../..'),
          scriptPath: join(root, '../site/.wrangler/worker/index.js'),
          compatibilityDate: '2026-09-04',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: { PLATFORM_DB: 'task-fixture' },
          bindings: { ...common, LVBT_DISCORD_PUBLIC_KEY: publicKey },
          serviceBindings: {
            DISCORD_WORK: { name: 'jobs', entrypoint: 'WorkPreview' },
            ...(options.manualUpdatesOnly ? { LVBT_DISCORD_JOBS: 'jobs' } : {}),
          },
          outboundService: async (request) => {
            const response = await options.workResponse?.(request, new URL(request.url));
            if (response) return response;
            throw new Error('The callback must not contact a provider');
          },
        },
        {
          name: 'jobs',
          modules: true,
          modulesRoot: join(root, '../..'),
          scriptPath: join(root, 'dist/index.js'),
          compatibilityDate: '2026-09-04',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: { PLATFORM_DB: 'task-fixture' },
          bindings: {
            ...common,
            LVBT_NOTION_TASK_API_KEY: 'fixture-only',
            LVBT_DISCORD_BOT_TOKEN: 'fixture-only',
          },
          outboundService: async (request) => {
            const url = new URL(request.url);
            const override = await options.workResponse?.(request, url);
            if (override) return override;
            providerCalls.push(`${request.method} ${url.origin}${url.pathname}`);
            if (url.origin === 'https://api.notion.com') return notionResponse(request, url);
            return discordResponse(request, url);
          },
        },
        {
          name: 'probe',
          compatibilityDate: '2026-09-04',
          modules: true,
          script: `export default {async fetch(request,env){ const key=new URL(request.url).pathname.slice(1); return ['scan','queue','operation','recovery','refresh','workIngest','workEffects','workRefresh'].includes(key) ? Response.json(await env[key].run()) : new Response(null,{status:404}); }}`,
          serviceBindings: {
            scan: { name: 'jobs', entrypoint: 'TaskCheckinScan' },
            queue: { name: 'jobs', entrypoint: 'TaskCheckinQueue' },
            operation: { name: 'jobs', entrypoint: 'TaskCheckinOperation' },
            recovery: { name: 'jobs', entrypoint: 'TaskCheckinRecovery' },
            refresh: { name: 'jobs', entrypoint: 'TaskCheckinRefresh' },
            workIngest: { name: 'jobs', entrypoint: 'DiscordWorkIngest' },
            workEffects: { name: 'jobs', entrypoint: 'DiscordWorkEffects' },
            workRefresh: { name: 'jobs', entrypoint: 'DiscordWorkRefresh' },
          },
        },
      ],
    }),
  );
  let interactionId = 666666666666666660n;
  async function signed(payload: Record<string, unknown>) {
    const body = JSON.stringify({
      application_id: applicationId,
      id: String(++interactionId),
      ...payload,
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = hex(sign(null, new TextEncoder().encode(timestamp + body), keys.privateKey));
    return (await simulator.getWorker('lvbt-task-site')).fetch(
      'https://preview.lasvegasfortransit.org/platform/discord/interactions',
      {
        method: 'POST',
        body,
        headers: { 'X-Signature-Ed25519': signature, 'X-Signature-Timestamp': timestamp },
      },
    );
  }
  try {
    const db = await simulator.getD1Database('PLATFORM_DB', 'jobs');
    await db.prepare('SELECT 1').first();
    const files = await readdir(data, { recursive: true });
    const file = files.find((name) => name.includes('d1') && name.endsWith('.sqlite'));
    assert.ok(file);
    const raw = new DatabaseSync(join(data, file));
    try {
      applyMigrations(raw);
    } finally {
      raw.close();
    }
    for (const person of ['member', 'guest', 'staff'])
      await db
        .prepare('INSERT INTO people(id,created_at,updated_at,membership_status) VALUES(?,?,?,?)')
        .bind(person, stamp, stamp, person === 'guest' ? 'not_member' : 'member')
        .run();
    await db
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES('staff','staff',?)",
      )
      .bind(stamp)
      .run();
    for (const account of accounts) {
      await db
        .prepare(
          "INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at) VALUES(?,?,'discord',?,?,'self_linked',?,?)",
        )
        .bind(`discord-${account.person}`, account.person, account.user, stamp, stamp, stamp)
        .run();
    }
    await saveTaskCheckinSource(
      db,
      {
        sourceId,
        workspaceId: 'workspace',
        expectedRevision: 0,
        enabled: true,
        actorId: 'staff',
        policy: {
          ...taskPolicy,
          quietStartMinute: 0,
          quietEndMinute: 0,
          digestHour: null,
          escalation: 'support',
          escalateBlockers: false,
        },
      },
      new Date(),
    );
    for (const account of accounts)
      await putNotionTaskMapping(
        db,
        {
          workspaceId: 'workspace',
          notionUserId: `notion-${account.person}`,
          personId: account.person,
          confirmedBy: 'staff',
        },
        new Date(),
      );
    interface Step {
      run(): Promise<{ kind: string; queued?: number }>;
    }
    const probe = await simulator.getWorker('probe');
    const step = (name: string): Step => ({
      run: async () => {
        const response = await probe.fetch(`https://fixture.invalid/${name}`);
        assert.equal(response.status, 200);
        return response.json() as Promise<{ kind: string; queued?: number }>;
      },
    });
    const steps = {
      scan: step('scan'),
      queue: step('queue'),
      operation: step('operation'),
      recovery: step('recovery'),
      refresh: step('refresh'),
      workIngest: step('workIngest'),
      workEffects: step('workEffects'),
      workRefresh: step('workRefresh'),
    };
    return {
      db,
      accounts,
      sourceId,
      guildId,
      signed,
      steps,
      sends,
      comments,
      completions,
      pages,
      faults,
      providerCalls,
      dispose: async () => {
        await simulator.dispose();
        await rm(data, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await simulator.dispose();
    await rm(data, { recursive: true, force: true });
    throw error;
  }
}
