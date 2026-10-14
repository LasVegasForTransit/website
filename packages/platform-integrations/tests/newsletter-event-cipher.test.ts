import assert from 'node:assert/strict';
import test from 'node:test';
import { randomToken } from '@lasvegasfortransit/platform-core/random-token';
import { NewsletterIntentCipher } from '../src/newsletter-intent-cipher';
void test('event addresses cannot be substituted across source events or outbound intents', async () => {
  const module = await import('../src/newsletter-event-cipher').catch(() => null);
  assert.ok(
    module,
    'incoming addresses need encryption bound to their own purpose and source event',
  );
  const key = randomToken(),
    cipher = new module.NewsletterEventCipher(key);
  const context = {
    id: 'evt_fixture',
    publicationId: 'pub_fixture',
    subscriptionId: 'sub_fixture',
    emailKey: 'email:fixture',
  };
  const encrypted = await cipher.encrypt('private@example.invalid', context);
  assert.ok(!encrypted.includes('private@example.invalid'));
  assert.equal(await cipher.decrypt(encrypted, context), 'private@example.invalid');
  for (const change of [
    { id: 'evt_other' },
    { publicationId: 'pub_other' },
    { subscriptionId: 'sub_other' },
    { emailKey: 'email:other' },
  ])
    await assert.rejects(() => cipher.decrypt(encrypted, { ...context, ...change }));
  await assert.rejects(() =>
    new NewsletterIntentCipher(key).decrypt(encrypted, {
      id: context.id,
      publicationId: context.publicationId,
      personId: context.subscriptionId,
    }),
  );
  await assert.rejects(() =>
    new module.NewsletterEventCipher(randomToken()).decrypt(encrypted, context),
  );
});
