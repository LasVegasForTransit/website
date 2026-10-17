import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { runDiscordCommandRegistration } from '../src/discord-command-registration';

const applicationId = '111111111111111111';
const guildId = '222222222222222222';
const command = {
  id: '444444444444444444',
  type: 1,
  name: 'link',
  description: 'Confirm your LVBT membership on the website',
  options: [],
};
const unrelated = { id: '555555555555555555', type: 1, name: 'other', description: 'Keep me' };
function fixture(existing: unknown[] = [unrelated]) {
  const db = memoryDb();
  let clock = Date.parse('2026-10-16T12:00:00Z');
  let commands = existing;
  let mode = '';
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const method = init?.method ?? 'GET';
    const path = input instanceof Request ? input.url : String(input);
    calls.push({
      method,
      path,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    });
    if (mode === 'limited')
      return Promise.resolve(Response.json({ retry_after: 3600, global: true }, { status: 429 }));
    if (method === 'GET') {
      if (mode === 'readback' && calls.length > 1) return Promise.resolve(Response.json([]));
      return Promise.resolve(Response.json(commands));
    }
    commands = [...commands.filter((item) => (item as { id: string }).id !== command.id), command];
    if (mode === 'lost-write')
      return Promise.reject(new Error('response lost after provider saved command'));
    return Promise.resolve(Response.json(command, { status: method === 'POST' ? 201 : 200 }));
  };
  const run = () =>
    runDiscordCommandRegistration(db, {
      applicationId,
      guildId,
      botToken: 'fixture-only',
      fetcher,
      now: () => new Date(clock),
    });
  return {
    db,
    calls,
    run,
    commands: () => commands,
    mode: (value: string) => {
      mode = value;
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}
void test('registers the canonical guild command, preserves unrelated commands and skips completed cold starts', async () => {
  const f = fixture([unrelated, { ...unrelated, name: 'link', type: 2 }]);
  try {
    assert.equal((await f.run()).kind, 'complete');
    assert.deepEqual(
      f.calls.map((call) => call.method),
      ['GET', 'POST', 'GET'],
    );
    assert.deepEqual(f.calls[1]?.body, {
      type: 1,
      name: 'link',
      description: command.description,
      options: [],
    });
    assert.ok(
      f.calls.every((call) =>
        call.path.includes(`/applications/${applicationId}/guilds/${guildId}/commands`),
      ),
    );
    assert.equal(f.commands().length, 3);
    f.advance(86400_000);
    assert.equal((await f.run()).kind, 'idle');
    assert.equal(f.calls.length, 3);
  } finally {
    f.db.raw.close();
  }
});
void test('uncertain readback never completes and retries are delayed', async () => {
  const f = fixture();
  try {
    f.mode('readback');
    assert.equal((await f.run()).kind, 'failed');
    assert.equal((await f.run()).kind, 'idle');
    assert.equal(f.calls.length, 3);
    f.advance(1800_000);
    f.mode('');
    assert.equal((await f.run()).kind, 'complete');
    assert.deepEqual(
      f.calls.map((call) => call.method),
      ['GET', 'POST', 'GET', 'GET'],
    );
  } finally {
    f.db.raw.close();
  }
});
void test('lost mutation response recovers by reading the saved command without another mutation', async () => {
  const f = fixture();
  try {
    f.mode('lost-write');
    assert.equal((await f.run()).kind, 'failed');
    f.advance(1800_000);
    f.mode('');
    assert.equal((await f.run()).kind, 'complete');
    assert.deepEqual(
      f.calls.map((call) => call.method),
      ['GET', 'POST', 'GET'],
    );
  } finally {
    f.db.raw.close();
  }
});
void test('429 persists application backoff and delays retries across fresh clients', async () => {
  const f = fixture();
  try {
    f.mode('limited');
    assert.equal((await f.run()).kind, 'paused');
    const pause = await f.db
      .prepare("SELECT expires_at FROM provider_backoffs WHERE provider='discord' AND context_id=?")
      .bind(applicationId)
      .first<{ expires_at: string }>();
    assert.equal(pause?.expires_at, '2026-10-16T13:00:00.000Z');
    f.advance(1800_000);
    f.mode('');
    assert.equal((await f.run()).kind, 'idle');
    assert.equal(f.calls.length, 1);
    f.advance(1800_000);
    assert.equal((await f.run()).kind, 'complete');
  } finally {
    f.db.raw.close();
  }
});
