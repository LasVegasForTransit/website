import assert from 'node:assert/strict';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { randomToken } from '@lasvegasfortransit/platform-core/random-token';

export async function fixture(consentSource: 'join_form' | 'import' = 'join_form') {
  const db = memoryDb(),
    people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'durable@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: consentSource,
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  const now = new Date(Date.now() + 1000);
  const calls: { method: string; path: string }[] = [];
  const subscriptions = new Map<
    string,
    { id: string; email: string; status: string; created: number }
  >();
  let beforeWrite: (() => Promise<void>) | undefined,
    ambiguous = false;
  const fetcher: typeof fetch = async (input, init) => {
    assert.ok(typeof input === 'string');
    const url = new URL(input),
      method = init?.method ?? 'GET';
    calls.push({ method, path: url.pathname });
    assert.equal(url.origin, 'https://api.beehiiv.com');
    assert.equal(init?.redirect, 'manual');
    if (method === 'POST') {
      if (beforeWrite) await beforeWrite();
      assert.ok(typeof init.body === 'string');
      const body = JSON.parse(init.body) as { email: string };
      const existing = [...subscriptions.values()].find((value) => value.email === body.email);
      const subscription = existing ?? {
        id: 'sub_created',
        email: body.email,
        status: 'inactive',
        created: Math.floor(now.getTime() / 1000) - 60,
      };
      subscription.status = 'active';
      subscriptions.set(subscription.id, subscription);
      return ambiguous
        ? new Response(null, { status: 503 })
        : Response.json({ data: subscription });
    }
    const id = url.pathname.split('/').at(-1) ?? '';
    const subscription = url.pathname.includes('/by_email/')
      ? [...subscriptions.values()].find((value) => value.email === decodeURIComponent(id))
      : subscriptions.get(id);
    if (!subscription) return new Response(null, { status: 404 });
    if (method === 'DELETE') {
      subscriptions.delete(subscription.id);
      return new Response(null, { status: 204 });
    }
    if (method === 'PATCH') subscription.status = 'inactive';
    return Response.json({ data: subscription });
  };
  return {
    db,
    people,
    person,
    subscriptions,
    calls,
    now,
    options: {
      configuration: { publicationId: 'pub_fixture', apiKey: 'fixture-only' },
      intentKey: randomToken(),
      fetcher,
      now: () => now,
      targetLimit: 10,
    },
    beforeWrite: (callback: () => Promise<void>) => {
      beforeWrite = callback;
    },
    ambiguous: () => {
      ambiguous = true;
    },
  };
}
