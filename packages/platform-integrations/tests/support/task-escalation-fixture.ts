import assert from 'node:assert/strict';
import { fixture, page, sourceId, now } from './task-action-fixture';
import { taskPolicy } from './task-checkins';
import { NotionTaskClient } from '../../src/notion-task-client';
import { DiscordTaskClient } from '../../src/notion-task-discord';
import type { DiscordOptions } from '../../src/discord-types';
import { setTaskCheckinConsent } from '@lasvegasfortransit/platform-storage/notion-task-checkins';
export async function ready() {
  const db = await fixture('blocker');
  db.raw
    .prepare(
      "INSERT INTO people(id,given_name,created_at,updated_at) VALUES('support','Helper',?,?)",
    )
    .run(now.toISOString(), now.toISOString());
  db.raw
    .prepare(
      "INSERT INTO identities(id,person_id,platform,external_id,link_method,linked_at,created_at,updated_at) VALUES('support','support','discord','111111111111111112','self_linked',?,?,?)",
    )
    .run(now.toISOString(), now.toISOString(), now.toISOString());
  db.raw.prepare('UPDATE task_checkin_sources SET policy_json=?').run(
    JSON.stringify({
      ...taskPolicy,
      escalation: 'support',
      supportPersonIds: ['support'],
      cohortPersonIds: ['member', 'support'],
    }),
  );
  await setTaskCheckinConsent(
    db,
    {
      sourceId,
      personId: 'support',
      discordUserId: '111111111111111112',
      interactionId: '100000000000000002',
      state: 'active',
      policyRevision: 1,
    },
    now,
  );
  db.raw
    .prepare(
      "UPDATE task_checkin_operations SET state='confirmed',payload_json=? WHERE id='response'",
    )
    .run(JSON.stringify({ text: 'Need help @everyone with the venue' }));
  return db;
}
export function providers(hook?: (url: string) => void, rateLimit?: DiscordOptions['rateLimit']) {
  const sent: string[] = [];
  const discord = new DiscordTaskClient({
    guildId: taskPolicy.guildId,
    botToken: 'fixture',
    ...(rateLimit ? { rateLimit } : {}),
    fetch: (url, init) => {
      assert.ok(typeof url === 'string');
      const address = url;
      hook?.(address);
      if (address.includes('/guilds/'))
        return Promise.resolve(
          Response.json({
            user: { id: address.split('/').at(-1), username: 'volunteer' },
            roles: [],
          }),
        );
      if (address.endsWith('/users/@me/channels'))
        return Promise.resolve(
          Response.json({
            id: '333333333333333333',
            type: 1,
            recipients: [{ id: '111111111111111112' }],
          }),
        );
      const body = typeof init?.body === 'string' ? init.body : '{}';
      sent.push(body);
      return Promise.resolve(
        Response.json({
          id: '444444444444444444',
          channel_id: '333333333333333333',
          nonce: (JSON.parse(body) as { nonce: string }).nonce,
        }),
      );
    },
  });
  return {
    sent,
    discord,
    notion: new NotionTaskClient('fixture', () => Promise.resolve(Response.json(page()))),
  };
}
