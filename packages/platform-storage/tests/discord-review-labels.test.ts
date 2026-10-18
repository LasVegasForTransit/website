import assert from 'node:assert/strict';
import test from 'node:test';

void test('Discord review translates fixed role labels while preserving committee names', async (t) => {
  const runtime = globalThis as { process?: { env: Record<string, string | undefined> } };
  assert.ok(runtime.process);
  runtime.process.env.LVBT_PSEUDO_LOCALE = '1';
  const { mergeFixture } = await import('./support/merge-fixture');
  const { listDiscordRoleReviews } = await import('../src/discord-roster');
  const f = await mergeFixture();
  t.after(() => f.db.raw.close());
  const guildId = '111111111111111111';
  const memberRoleId = '333333333333333333';
  const leadRoleId = '444444444444444444';
  const stamp = new Date().toISOString();
  await f.db.prepare("UPDATE committees SET name='交通 123' WHERE id='events'").run();
  await f.db
    .prepare(
      "INSERT INTO committee_account_mappings(committee_id,provider,external_id,role_kind,recorded_at) VALUES('events','discord',?,'lead',?)",
    )
    .bind(leadRoleId, stamp)
    .run();
  await f.db
    .prepare(
      'INSERT INTO discord_role_reviews(guild_id,discord_user_id,managed_role_ids,first_seen_at,last_seen_at,last_seen_scan_id) VALUES(?,?,?,?,?,?)',
    )
    .bind(
      guildId,
      '700000000000000001',
      JSON.stringify([leadRoleId, memberRoleId]),
      stamp,
      stamp,
      stamp,
    )
    .run();
  const page = await listDiscordRoleReviews(f.db, f.actor, { guildId, memberRoleId });
  const member = page.items[0]?.roles[0],
    lead = page.items[0]?.roles[1];
  assert.ok(member && lead);
  assert.equal(member.id, memberRoleId);
  assert.match(member.label, /^\[/);
  assert.match(lead.label, /^\[/);
  assert.ok(lead.label.includes('交通 123'));
});
