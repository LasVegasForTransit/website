import assert from 'node:assert/strict';
import test from 'node:test';
import {
  channelsOpenedBy,
  parseDiscordChannelsInput,
  plainTopic,
  readDiscordChannels,
} from '../src/discord-channels';

const GUILD = '100000000000000001';
const MEMBER = '200000000000000002';
const EVENTS = '300000000000000003';
const LEADS = '400000000000000004';
const VIEW = String(1n << 10n);

const roles = [
  { id: GUILD, permissions: 1n << 10n },
  { id: MEMBER, permissions: 0n },
  { id: EVENTS, permissions: 0n },
  { id: LEADS, permissions: 0n },
];
const hidden = (allow: string[]) => [
  { id: GUILD, type: 0, allow: 0n, deny: 1n << 10n },
  ...allow.map((role) => ({ id: role, type: 0, allow: 1n << 10n, deny: 0n })),
];
interface Fixture {
  id: string;
  name: string;
  position: number;
  overwrites?: ReturnType<typeof hidden>;
  type?: number;
  parentId?: string | null;
  topic?: string | null;
}
const channel = ({
  id,
  name,
  position,
  overwrites = [],
  type = 0,
  parentId = null,
  topic = null,
}: Fixture) => ({ id, name, type, position, parentId, topic, overwrites });
const MEMBERS = '500000000000000010';
const COMMITTEES = '500000000000000020';
const channels = [
  channel({ id: MEMBERS, name: 'members', position: 1, type: 4 }),
  channel({ id: COMMITTEES, name: 'committees', position: 2, type: 4 }),
  channel({ id: '500000000000000001', name: 'welcome', position: 0 }),
  channel({
    id: '500000000000000002',
    name: 'events',
    position: 0,
    topic: 'Plan rides and meetups',
    overwrites: hidden([EVENTS]),
    parentId: COMMITTEES,
  }),
  channel({
    id: '500000000000000003',
    name: 'events-leads',
    position: 1,
    overwrites: hidden([LEADS]),
    parentId: COMMITTEES,
  }),
  channel({
    id: '500000000000000004',
    name: 'general',
    position: 0,
    overwrites: hidden([MEMBER]),
    parentId: MEMBERS,
  }),
  channel({
    id: '500000000000000005',
    name: 'member-voice',
    position: 1,
    overwrites: hidden([MEMBER]),
    type: 2,
    parentId: MEMBERS,
  }),
];

void test('lists only the linkable channels a member’s roles open, in sidebar order', () => {
  assert.deepEqual(
    channelsOpenedBy(GUILD, roles, channels, [MEMBER, EVENTS]).map((c) => c.name),
    ['general', 'events'],
  );
  assert.deepEqual(
    channelsOpenedBy(GUILD, roles, channels, [MEMBER, EVENTS, LEADS]).map((c) => c.name),
    ['general', 'events', 'events-leads'],
  );
  // Channels everyone can already see are not listed as something connecting opened.
  assert.deepEqual(channelsOpenedBy(GUILD, roles, channels, []), []);
});

void test('describes each channel by its topic, or its category when it has none', () => {
  assert.deepEqual(
    channelsOpenedBy(GUILD, roles, channels, [MEMBER, EVENTS]).map((c) => c.description),
    ['members', 'Plan rides and meetups'],
  );
  assert.equal(
    plainTopic(
      'Ask <@&400000000000000004> in <#500000000000000002> about **buses** <:bus:123456789012345678>',
      new Map([
        [LEADS, 'Leads'],
        ['500000000000000002', 'events'],
      ]),
    ),
    'Ask @Leads in #events about buses',
  );
  assert.equal(plainTopic('Hi <@&999999999999999999> <@123456789012345678>'), 'Hi');
  assert.equal(plainTopic('   '), null);
  assert.equal(plainTopic('x'.repeat(400))?.length, 160);
});

void test('a role deny wins over @everyone and an allow from another role wins over a deny', () => {
  const denied = [
    channel({
      id: '600000000000000001',
      name: 'announcements',
      position: 0,
      overwrites: [
        { id: GUILD, type: 0, allow: 0n, deny: 1n << 10n },
        { id: MEMBER, type: 0, allow: 0n, deny: 1n << 10n },
        { id: EVENTS, type: 0, allow: 1n << 10n, deny: 0n },
      ],
    }),
  ];
  assert.deepEqual(channelsOpenedBy(GUILD, roles, denied, [MEMBER]), []);
  assert.deepEqual(
    channelsOpenedBy(GUILD, roles, denied, [MEMBER, EVENTS]).map((c) => c.name),
    ['announcements'],
  );
});

void test('input from the site is limited to Discord ids', () => {
  assert.deepEqual(parseDiscordChannelsInput({ member: true, roleIds: [EVENTS, EVENTS] }), {
    member: true,
    roleIds: [EVENTS],
  });
  assert.equal(parseDiscordChannelsInput({ member: true, roleIds: ['1 OR 1'] }), null);
  assert.equal(parseDiscordChannelsInput({ member: 'yes', roleIds: [] }), null);
  assert.equal(
    parseDiscordChannelsInput({ member: true, roleIds: Array.from({ length: 51 }, () => EVENTS) }),
    null,
  );
});

void test('reads roles and channels with the bot token and adds the Member role', async () => {
  const requested: string[] = [];
  const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requested.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bot test-bot');
    if (url.pathname.endsWith('/roles'))
      return Promise.resolve(
        Response.json([
          { id: GUILD, permissions: VIEW },
          { id: MEMBER, permissions: '0' },
        ]),
      );
    return Promise.resolve(
      Response.json([
        {
          id: '700000000000000001',
          name: 'general',
          type: 0,
          position: 0,
          parent_id: null,
          topic: 'Say hello',
          permission_overwrites: [
            { id: GUILD, type: 0, allow: '0', deny: VIEW },
            { id: MEMBER, type: 0, allow: VIEW, deny: '0' },
          ],
        },
      ]),
    );
  }) as typeof fetch;
  const links = await readDiscordChannels(
    {
      environment: 'preview',
      guildId: GUILD,
      productionGuildId: '100000000000000009',
      botToken: 'test-bot',
    },
    MEMBER,
    { member: true, roleIds: [] },
    { fetch: fetcher },
  );
  assert.deepEqual(links, [
    { id: '700000000000000001', name: 'general', description: 'Say hello' },
  ]);
  assert.deepEqual(requested, [
    `GET /api/v10/guilds/${GUILD}/roles`,
    `GET /api/v10/guilds/${GUILD}/channels`,
  ]);
});
