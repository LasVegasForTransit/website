import assert from 'node:assert/strict';
import { ORIGIN, startRuntime } from '../support/runtime';

const fixture = await startRuntime({ discord: true });
const guildId = '111111111111111111';
const memberRoleId = '333333333333333333';
const stamp = '2026-10-12T10:00:00.000Z';
try {
  const accounts: Array<[string, string | null, string | null, string | null]> = [
    ['700000000000000001', 'rider.one', 'Rider', '<b>Rider</b>'],
    ['700000000000000002', 'rider.two', 'Rider', null],
    ['700000000000000003', 'rider.three', null, null],
    ['700000000000000004', null, null, null],
  ];
  for (const [id, username, displayName, nickname] of accounts) {
    await fixture.db
      .prepare(
        'INSERT INTO discord_role_reviews(guild_id,discord_user_id,managed_role_ids,first_seen_at,last_seen_at,last_seen_scan_id,username,display_name,nickname) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        guildId,
        id,
        JSON.stringify([memberRoleId]),
        stamp,
        stamp,
        stamp,
        username,
        displayName,
        nickname,
      )
      .run();
  }
  const headers = {
    'Cf-Access-Jwt-Assertion': fixture.admin.assertion,
    Cookie: `__Host-lvbt_session=${fixture.admin.session.token}`,
  };
  const response = await fixture.simulator.dispatchFetch(`${ORIGIN}/access/`, { headers });
  assert.equal(response.status, 200);
  const body = await response.text();
  const section = /<section class="staff-discord-review"[\s\S]*?<\/section>/.exec(body)?.[0];
  assert.ok(section);
  assert.match(section, /<strong>&lt;b&gt;Rider&lt;\/b&gt;<\/strong>/);
  assert.equal(section.includes('<b>Rider</b>'), false, 'provider names are text, never markup');
  assert.match(section, /<strong>Rider<\/strong>/);
  assert.match(section, /<strong>rider.three<\/strong>/);
  assert.match(section, /Account name unavailable/);
  for (const username of ['rider.one', 'rider.two', 'rider.three']) {
    assert.equal(section.includes(`@${username}`), true);
    assert.equal(section.includes(`aria-label="Open Discord profile for @${username}"`), true);
  }
  assert.equal(section.includes('aria-label="Open Discord profile for account 4"'), true);
  assert.equal((section.match(/>LVBT Member</g) ?? []).length, 4);
  assert.equal(
    section.includes('>70000000000000000'),
    false,
    'raw account IDs are not primary copy',
  );
  assert.equal((section.match(/https:\/\/discord.com\/users\//g) ?? []).length, 4);
  const denied = await fixture.simulator.dispatchFetch(`${ORIGIN}/access/`, {
    headers: {
      'Cf-Access-Jwt-Assertion': fixture.lead.assertion,
      Cookie: `__Host-lvbt_session=${fixture.lead.session.token}`,
    },
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.text()).includes('rider.one'), false);
  console.log('Compiled staff Discord review names, fallback, escaping and authorization passed.');
} finally {
  await fixture.dispose();
}
