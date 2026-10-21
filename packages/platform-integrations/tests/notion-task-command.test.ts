import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';

void test('check-in setup registers independently without replacing the link command or repeating on cold starts', async () => {
  const module = await import('../src/notion-task-command').catch(() => null);
  assert.ok(module, 'the volunteer-started setup command must be registered');
  const db = memoryDb();
  const original = {
    id: '555555555555555555',
    type: 1,
    name: 'link',
    description: 'Keep the existing link command',
    options: [],
  };
  let commands: unknown[] = [original];
  const writes: unknown[] = [];
  const fetcher: typeof fetch = (_input, init) => {
    if (init?.method === 'POST') {
      const payload: unknown = JSON.parse(typeof init.body === 'string' ? init.body : '');
      writes.push(payload);
      const command = { ...(payload as Record<string, unknown>), id: '666666666666666666' };
      commands = [...commands, command];
      return Promise.resolve(Response.json(command));
    }
    return Promise.resolve(Response.json(commands));
  };
  const input = {
    applicationId: '111111111111111111',
    guildId: '222222222222222222',
    botToken: 'fixture-only',
    fetcher,
  };
  try {
    assert.equal((await module.runTaskCheckinCommandRegistration(db, input)).kind, 'complete');
    assert.deepEqual(commands[0], original);
    assert.equal(writes.length, 1);
    assert.equal((writes[0] as { name: string }).name, 'checkins');
    assert.equal((await module.runTaskCheckinCommandRegistration(db, input)).kind, 'idle');
    assert.equal(writes.length, 1);
  } finally {
    db.raw.close();
  }
});
