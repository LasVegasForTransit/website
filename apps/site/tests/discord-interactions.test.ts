import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as signBytes } from 'node:crypto';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { DiscordLinkService } from '@lasvegasfortransit/platform-storage/discord-link';
import { createSession } from '@lasvegasfortransit/platform-storage/auth';
import { onRequestPost } from '../functions/platform/discord/interactions';

const APPLICATION_ID = '111111111111111111';
const GUILD_ID = '222222222222222222';
const USER_ID = '333333333333333333';

function signedRequest(payload: unknown) {
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const pair = generateKeyPairSync('ed25519');
  const spki = pair.publicKey.export({ format: 'der', type: 'spki' });
  const publicKey = new Uint8Array(spki.subarray(spki.byteLength - 32));
  const signature = new Uint8Array(
    signBytes(null, new TextEncoder().encode(timestamp + rawBody), pair.privateKey),
  );
  const hex = (bytes: Uint8Array) =>
    Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return {
    publicKey: hex(publicKey),
    request: new Request('https://lasvegasfortransit.org/platform/discord/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature-Ed25519': hex(signature),
        'X-Signature-Timestamp': timestamp,
      },
      body: rawBody,
    }),
  };
}

void test('the Discord interactions endpoint rejects unsigned requests', async () => {
  const response = await onRequestPost({
    env: { LVBT_DISCORD_PUBLIC_KEY: '00'.repeat(32) },
    request: new Request('https://lasvegasfortransit.org/platform/discord/interactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"type":1}',
    }),
  } as unknown as Parameters<typeof onRequestPost>[0]);
  assert.equal(response.status, 401);
});

void test('a verified Discord PING receives a PONG response', async () => {
  const signed = signedRequest({ type: 1 });
  const response = await onRequestPost({
    env: { LVBT_DISCORD_PUBLIC_KEY: signed.publicKey },
    request: signed.request,
  } as unknown as Parameters<typeof onRequestPost>[0]);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type') ?? '', /^application\/json/);
  assert.deepEqual(await response.json(), { type: 1 });
});

void test('an unlinked /link command gets a private button to the member connection page', async () => {
  const signed = signedRequest({
    type: 2,
    application_id: APPLICATION_ID,
    guild_id: GUILD_ID,
    data: { name: 'link' },
    member: { user: { id: USER_ID } },
  });
  const response = await onRequestPost({
    env: {
      LVBT_DISCORD_PUBLIC_KEY: signed.publicKey,
      LVBT_DISCORD_APPLICATION_ID: APPLICATION_ID,
      LVBT_DISCORD_GUILD_ID: GUILD_ID,
      PLATFORM_DB: memoryDb(),
    },
    request: signed.request,
  } as unknown as Parameters<typeof onRequestPost>[0]);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    type: 4,
    data: {
      content:
        "Connect your Discord to your LVBT account and you'll get the LVBT Member role, plus your committee roles if you volunteer. It takes a minute on the website.",
      flags: 64,
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: 'Connect on lasvegasfortransit.org',
              url: 'https://lasvegasfortransit.org/account/discord/',
            },
          ],
        },
      ],
      allowed_mentions: { parse: [] },
    },
  });
});

void test('a linked /link command gets a private button to the member account', async () => {
  const db = memoryDb();
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'discord-link-command@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-session-only' };
  const session = await createSession(env, person.id, 'member');
  const service = new DiscordLinkService(env);
  const started = await service.begin({
    sessionToken: session.token,
    origin: 'https://lasvegasfortransit.org',
  });
  assert.ok(started);
  const claim = await service.claim({
    state: started.state,
    sessionToken: session.token,
    origin: 'https://lasvegasfortransit.org',
  });
  assert.ok(claim);
  assert.equal(
    await service.complete({
      claim,
      identity: { id: USER_ID, username: 'lvbt-member', displayName: 'LVBT Member', avatar: null },
    }),
    true,
  );

  const signed = signedRequest({
    type: 2,
    application_id: APPLICATION_ID,
    guild_id: GUILD_ID,
    data: { name: 'link' },
    member: { user: { id: USER_ID } },
  });
  const response = await onRequestPost({
    env: {
      LVBT_DISCORD_PUBLIC_KEY: signed.publicKey,
      LVBT_DISCORD_APPLICATION_ID: APPLICATION_ID,
      LVBT_DISCORD_GUILD_ID: GUILD_ID,
      PLATFORM_DB: db,
    },
    request: signed.request,
  } as unknown as Parameters<typeof onRequestPost>[0]);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    type: 4,
    data: {
      content: 'Your Discord is already connected to your LVBT account.',
      flags: 64,
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: 'Open your LVBT account',
              url: 'https://lasvegasfortransit.org/account/',
            },
          ],
        },
      ],
      allowed_mentions: { parse: [] },
    },
  });
});

void test('the Discord interactions endpoint rejects a body changed after signing', async () => {
  const signed = signedRequest({
    type: 2,
    application_id: APPLICATION_ID,
    guild_id: GUILD_ID,
    data: { name: 'link' },
    member: { user: { id: USER_ID } },
  });
  const request = new Request(signed.request.url, {
    method: 'POST',
    headers: signed.request.headers,
    body: (await signed.request.text()).replace('"name":"link"', '"name":"other"'),
  });
  const response = await onRequestPost({
    env: { LVBT_DISCORD_PUBLIC_KEY: signed.publicKey },
    request,
  } as unknown as Parameters<typeof onRequestPost>[0]);
  assert.equal(response.status, 401);
});
