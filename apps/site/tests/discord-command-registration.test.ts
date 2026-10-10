import assert from 'node:assert/strict';
import test from 'node:test';
import {
  registerLinkCommand,
  runLinkCommandRegistration,
} from '../scripts/discord/register-link-command';

const APPLICATION_ID = '111111111111111111';
const GUILD_ID = '222222222222222222';
const COMMAND_ID = '444444444444444444';
const BOT_TOKEN = 'test-token-never-a-real-secret';

function fakeDiscord(existing: unknown[] = []) {
  const calls: Array<{
    url: string;
    method: string;
    body: string | undefined;
    authorization: string | null;
  }> = [];
  const fetcher: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
      authorization: headers.get('Authorization'),
    });
    const body = calls.length === 1 ? existing : { id: COMMAND_ID, name: 'link' };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  };
  return { calls, fetcher };
}

void test('registering /link creates only an LVBT guild command', async () => {
  const { calls, fetcher } = fakeDiscord();
  const result = await registerLinkCommand({
    applicationId: APPLICATION_ID,
    guildId: GUILD_ID,
    botToken: BOT_TOKEN,
    fetcher,
  });
  const collection = `https://discord.com/api/v10/applications/${APPLICATION_ID}/guilds/${GUILD_ID}/commands`;
  assert.equal(result, 'created');
  assert.deepEqual(
    calls.map(({ url, method }) => ({ url, method })),
    [
      { url: collection, method: 'GET' },
      { url: collection, method: 'POST' },
    ],
  );
  assert.equal(calls[0]?.authorization, `Bot ${BOT_TOKEN}`);
  assert.deepEqual(JSON.parse(calls[1]?.body ?? '{}'), {
    name: 'link',
    description: 'Connect your Discord to your LVBT account to get your member role',
  });
});

void test('registering /link updates the existing guild command without replacing others', async () => {
  const { calls, fetcher } = fakeDiscord([
    { id: COMMAND_ID, name: 'link' },
    { id: '555555555555555555', name: 'another-command' },
  ]);
  const result = await registerLinkCommand({
    applicationId: APPLICATION_ID,
    guildId: GUILD_ID,
    botToken: BOT_TOKEN,
    fetcher,
  });
  assert.equal(result, 'updated');
  assert.equal(calls.length, 2);
  const update = calls[1];
  assert.ok(update);
  assert.equal(update.method, 'PATCH');
  assert.match(update.url, /\/commands\/444444444444444444$/);
  assert.deepEqual(JSON.parse(update.body ?? '{}'), {
    name: 'link',
    description: 'Connect your Discord to your LVBT account to get your member role',
  });
});

void test('registering /link refuses an ambiguous existing command list', async () => {
  const { calls, fetcher } = fakeDiscord([
    { id: COMMAND_ID, name: 'link' },
    { id: '555555555555555555', name: 'link' },
  ]);
  await assert.rejects(
    registerLinkCommand({
      applicationId: APPLICATION_ID,
      guildId: GUILD_ID,
      botToken: BOT_TOKEN,
      fetcher,
    }),
    /multiple guild commands named link/,
  );
  assert.equal(calls.length, 1, 'an ambiguous command list must not be changed');
});

void test('the registration CLI stops before contacting Discord when configuration is missing', async () => {
  const { calls, fetcher } = fakeDiscord();
  const errors: string[] = [];
  const exitCode = await runLinkCommandRegistration(
    {},
    { stdout: () => {}, stderr: (m) => errors.push(m) },
    fetcher,
  );
  assert.equal(exitCode, 2);
  assert.equal(calls.length, 0);
  assert.match(errors.join('\n'), /LVBT_DISCORD_APPLICATION_ID/);
});
