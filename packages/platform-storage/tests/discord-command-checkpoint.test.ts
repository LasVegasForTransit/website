import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { claimDiscordCommand, settleDiscordCommand } from '../src/discord-command-checkpoint';

void test('a concurrent or interrupted registration cannot retry before its durable deadline', async () => {
  const db = memoryDb();
  try {
    const contextId = 'command-link:fixture';
    const now = new Date('2026-10-16T12:00:00Z');
    const lease = await claimDiscordCommand(db, contextId, now);
    assert.ok(lease);
    assert.equal(await claimDiscordCommand(db, contextId, now), null);
    const expired = new Date(now.getTime() + 60_000);
    assert.equal(await claimDiscordCommand(db, contextId, expired), null);
    assert.equal(await settleDiscordCommand(db, lease, expired, { complete: true }), false);
    const later = new Date(now.getTime() + 1800_000);
    const next = await claimDiscordCommand(db, contextId, later);
    assert.ok(next);
    assert.notEqual(next.token, lease.token);
    assert.equal(await settleDiscordCommand(db, lease, later, { complete: true }), false);
    assert.equal(await settleDiscordCommand(db, next, later, { complete: true }), true);
    assert.equal(
      await claimDiscordCommand(db, contextId, new Date(later.getTime() + 86400_000)),
      null,
    );
    assert.ok(await claimDiscordCommand(db, 'command-link:different-definition', later));
  } finally {
    db.raw.close();
  }
});
