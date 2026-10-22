import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { runDiscordCommandRegistration } from '../src/discord-command-registration';
void test('work setup and the message command register without replacing existing commands', async () => {
  const module = await import('../src/discord-work-command').catch(() => null);
  assert.ok(module, 'work command definitions exist');
  const db = memoryDb();
  const original = {
    id: '111111111111111111',
    type: 1,
    name: 'link',
    description: 'Existing command',
    options: [],
  };
  const commands: Record<string, unknown>[] = [original];
  const fetcher: typeof fetch = (_input, init) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(typeof init.body === 'string' ? init.body : '') as Record<
        string,
        unknown
      >;
      const command = { ...body, id: String(222222222222222222n + BigInt(commands.length)) };
      commands.push(command);
      return Promise.resolve(Response.json(command, { status: 201 }));
    }
    return Promise.resolve(Response.json(commands));
  };
  try {
    const options = {
      applicationId: '333333333333333333',
      guildId: '444444444444444444',
      botToken: 'fixture-only',
      fetcher,
    };
    for (const command of [module.WORK_COMMAND, module.SAVE_TO_NOTION_COMMAND]) {
      assert.equal(
        (await runDiscordCommandRegistration(db, { ...options, command })).kind,
        'complete',
      );
      assert.equal((await runDiscordCommandRegistration(db, { ...options, command })).kind, 'idle');
    }
    assert.deepEqual(commands[0], original);
    assert.equal(commands.length, 3);
    assert.equal(commands[2]?.type, 3);
  } finally {
    db.raw.close();
  }
});
