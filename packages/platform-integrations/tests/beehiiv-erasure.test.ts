import assert from 'node:assert/strict';
import test from 'node:test';
import { BeehiivSubscriptions } from '../src/beehiiv-subscriptions';
import { reconcileBeehiivPerson } from '../src/beehiiv-sync';
import { queryBudget } from '@lasvegasfortransit/platform-storage/query-budget';
import { everyStoredText } from '@lasvegasfortransit/platform-storage/test-db';
import { runMaintenance } from '@lasvegasfortransit/platform-storage/retention';
import { pendingNewsletterPeople } from '@lasvegasfortransit/platform-storage/newsletter-sync-store';
import { fixture } from './support/beehiiv-sync-fixture';

const config = { publicationId: 'pub_fixture', apiKey: 'fixture-only' };

void test('subscriber removal requires a separate absence read and treats repeated deletion safely', async () => {
  for (const status of [204, 404]) {
    const methods: string[] = [];
    const client = new BeehiivSubscriptions(config, {
      fetcher: (_input, init) => {
        methods.push(init?.method ?? 'GET');
        return Promise.resolve(
          new Response(null, { status: init?.method === 'DELETE' ? status : 404 }),
        );
      },
    });
    assert.deepEqual(await client.remove('sub_fixture'), { ok: true, subscription: null });
    assert.deepEqual(methods, ['DELETE', 'GET']);
  }
});

void test('a successful removal response without absence proof remains unconfirmed', async () => {
  const client = new BeehiivSubscriptions(config, {
    fetcher: (_input, init) =>
      Promise.resolve(
        init?.method === 'DELETE'
          ? new Response(null, { status: 204 })
          : Response.json({
              data: {
                id: 'sub_fixture',
                email: 'fixture@example.invalid',
                status: 'inactive',
                created: 1700000000,
              },
            }),
      ),
  });
  assert.deepEqual(await client.remove('sub_fixture'), {
    ok: false,
    kind: 'not_confirmed',
    status: 200,
    retryAfterMs: 60_000,
  });
});

void test('ordinary account erasure unsubscribes then removes the subscriber within the worker’s bounded pass', async () => {
  const f = await fixture();
  try {
    await reconcileBeehiivPerson(f.db, f.person.id, f.options);
    await f.people.deletePerson(f.person.id);
    // Deletion queues work on the real clock; dispatch must observe that later instant.
    f.now.setTime(Math.max(f.now.getTime(), Date.now() + 1));
    f.calls.length = 0;
    const fetcher: typeof fetch = async (input, init) => {
      if (init?.method !== 'DELETE') return f.options.fetcher(input, init);
      assert.ok(typeof input === 'string');
      f.calls.push({ method: 'DELETE', path: new URL(input).pathname });
      assert.equal(f.subscriptions.get('sub_created')?.status, 'inactive');
      f.subscriptions.delete('sub_created');
      return new Response(null, { status: 204 });
    };
    const budget = queryBudget(f.db, 50);
    assert.deepEqual(await pendingNewsletterPeople(budget.db, f.now, 1), [f.person.id]);
    assert.equal(
      (
        await reconcileBeehiivPerson(budget.db, f.person.id, {
          ...f.options,
          fetcher,
          targetLimit: 1,
        })
      ).kind,
      'confirmed',
    );
    assert.deepEqual(
      f.calls.map((call) => call.method),
      ['GET', 'PATCH', 'GET', 'DELETE', 'GET'],
    );
    assert.equal(f.subscriptions.has('sub_created'), false);
    assert.equal(await f.people.getPerson(f.person.id), null);
    assert.ok(budget.queries <= 50);
    assert.ok(budget.largestBindings <= 100);
    assert.equal(everyStoredText(f.db).includes('durable@example.invalid'), false);
  } finally {
    f.db.raw.close();
  }
});

void test('a lost successful deletion response retries from stored ownership without a second deletion or profile restoration', async () => {
  const f = await fixture();
  try {
    await reconcileBeehiivPerson(f.db, f.person.id, f.options);
    await f.people.deletePerson(f.person.id);
    let deletions = 0;
    const fetcher: typeof fetch = async (input, init) => {
      if (init?.method !== 'DELETE') return f.options.fetcher(input, init);
      deletions++;
      f.subscriptions.delete('sub_created');
      return new Response(null, { status: 503 });
    };
    const options = { ...f.options, fetcher, targetLimit: 1 };
    assert.equal((await reconcileBeehiivPerson(f.db, f.person.id, options)).kind, 'retry');
    assert.equal(deletions, 1);
    assert.equal(f.db.raw.prepare('SELECT state FROM newsletter_sync_jobs').get()?.state, 'retry');
    f.now.setTime(f.now.getTime() + 61_000);
    assert.equal(
      (await reconcileBeehiivPerson(queryBudget(f.db, 50).db, f.person.id, options)).kind,
      'confirmed',
    );
    assert.equal(deletions, 1);
    assert.equal(await f.people.getPerson(f.person.id), null);
  } finally {
    f.db.raw.close();
  }
});

void test('an earlier completed unsubscribe retains enough stable receipt data to finish actual erasure', async () => {
  const f = await fixture();
  try {
    await f.people.deletePerson(f.person.id);
    f.subscriptions.set('sub_created', {
      id: 'sub_created',
      email: 'durable@example.invalid',
      status: 'inactive',
      created: Math.floor(f.now.getTime() / 1000) - 60,
    });
    f.db.raw
      .prepare(
        'INSERT INTO newsletter_target_receipts(publication_id,person_id,generation,revision_hash,target_key,desired,observed_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        'pub_fixture',
        f.person.id,
        1,
        'old_revision',
        'id:sub_created',
        'inactive',
        f.now.toISOString(),
      );
    const fetcher: typeof fetch = async (input, init) => {
      if (init?.method !== 'DELETE') return f.options.fetcher(input, init);
      assert.ok(typeof input === 'string');
      f.calls.push({ method: 'DELETE', path: new URL(input).pathname });
      f.subscriptions.delete('sub_created');
      return new Response(null, { status: 204 });
    };
    assert.equal(
      (
        await reconcileBeehiivPerson(queryBudget(f.db, 50).db, f.person.id, {
          ...f.options,
          fetcher,
        })
      ).kind,
      'confirmed',
    );
    assert.equal(f.subscriptions.has('sub_created'), false);
    assert.deepEqual(
      f.calls.map((call) => call.method),
      ['GET', 'DELETE', 'GET'],
    );
  } finally {
    f.db.raw.close();
  }
});

for (const archived of [false, true]) {
  void test(`an unsubscribe or reversible archive never authorizes subscriber deletion; archive=${archived}`, async () => {
    const f = await fixture();
    try {
      await reconcileBeehiivPerson(f.db, f.person.id, f.options);
      if (archived)
        f.db.raw
          .prepare('UPDATE people SET deleted_at=? WHERE id=?')
          .run(f.now.toISOString(), f.person.id);
      else
        await f.people.withdrawConsent(f.person.id, {
          scope: 'newsletter',
          source: 'account',
          withdrawnAt: f.now.toISOString(),
        });
      assert.equal((await reconcileBeehiivPerson(f.db, f.person.id, f.options)).kind, 'confirmed');
      assert.equal(f.subscriptions.get('sub_created')?.status, 'inactive');
      assert.equal(
        f.calls.some((call) => call.method === 'DELETE'),
        false,
      );
    } finally {
      f.db.raw.close();
    }
  });
}

for (const status of [403, 429]) {
  void test(`a refused subscriber deletion retains cleanup without recording success; status=${status}`, async () => {
    const f = await fixture();
    try {
      await reconcileBeehiivPerson(f.db, f.person.id, f.options);
      await f.people.deletePerson(f.person.id);
      const fetcher: typeof fetch = async (input, init) =>
        init?.method === 'DELETE'
          ? new Response(null, { status, headers: { 'Retry-After': '120' } })
          : f.options.fetcher(input, init);
      const options = { ...f.options, fetcher, targetLimit: 1 };
      assert.equal(
        (await reconcileBeehiivPerson(queryBudget(f.db, 50).db, f.person.id, options)).kind,
        status === 403 ? 'needs_review' : 'retry',
      );
      assert.equal(f.subscriptions.has('sub_created'), true);
      assert.equal(
        f.db.raw
          .prepare(
            'SELECT count(*) AS n FROM newsletter_target_receipts r JOIN newsletter_sync_jobs j ON j.person_id=r.person_id AND j.generation=r.generation',
          )
          .get()?.n,
        0,
      );
      if (status === 429) {
        const before = f.calls.length;
        f.now.setTime(f.now.getTime() + 60_000);
        assert.equal((await reconcileBeehiivPerson(f.db, f.person.id, options)).kind, 'retry');
        assert.equal(f.calls.length, before);
        f.now.setTime(f.now.getTime() + 61_000);
        assert.equal(
          (await reconcileBeehiivPerson(f.db, f.person.id, { ...f.options, targetLimit: 1 })).kind,
          'confirmed',
        );
        assert.equal(f.subscriptions.has('sub_created'), false);
      }
    } finally {
      f.db.raw.close();
    }
  });
}

void test('a deletion that leaves the provider record retries until absence is confirmed', async () => {
  const f = await fixture();
  try {
    await reconcileBeehiivPerson(f.db, f.person.id, f.options);
    await f.people.deletePerson(f.person.id);
    const fetcher: typeof fetch = async (input, init) =>
      init?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : f.options.fetcher(input, init);
    assert.equal(
      (
        await reconcileBeehiivPerson(queryBudget(f.db, 50).db, f.person.id, {
          ...f.options,
          fetcher,
          targetLimit: 1,
        })
      ).kind,
      'retry',
    );
    assert.equal(f.subscriptions.has('sub_created'), true);
    f.now.setTime(f.now.getTime() + 61_000);
    assert.equal(
      (
        await reconcileBeehiivPerson(queryBudget(f.db, 50).db, f.person.id, {
          ...f.options,
          targetLimit: 1,
        })
      ).kind,
      'confirmed',
    );
    assert.equal(f.subscriptions.has('sub_created'), false);
  } finally {
    f.db.raw.close();
  }
});

void test('erasure never follows a historical receipt from another publication', async () => {
  const f = await fixture();
  try {
    await f.people.deletePerson(f.person.id);
    f.db.raw
      .prepare(
        'INSERT INTO newsletter_target_receipts(publication_id,person_id,generation,revision_hash,target_key,desired,observed_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        'pub_other',
        f.person.id,
        1,
        'old_revision',
        'id:sub_unrelated',
        'inactive',
        f.now.toISOString(),
      );
    assert.equal((await reconcileBeehiivPerson(f.db, f.person.id, f.options)).kind, 'confirmed');
    assert.equal(f.calls.length, 0);
  } finally {
    f.db.raw.close();
  }
});

void test('provider deletion finishes after the erased personal profile has been physically purged', async () => {
  const f = await fixture();
  try {
    await reconcileBeehiivPerson(f.db, f.person.id, f.options);
    await f.people.deletePerson(f.person.id);
    f.now.setTime(f.now.getTime() + 31 * 86_400_000);
    assert.equal(
      (await runMaintenance(f.db, { now: f.now, category: 'profiles' })).profilesRemoved,
      1,
    );
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
    assert.equal(
      (
        await reconcileBeehiivPerson(queryBudget(f.db, 50).db, f.person.id, {
          ...f.options,
          targetLimit: 1,
        })
      ).kind,
      'confirmed',
    );
    assert.equal(f.subscriptions.has('sub_created'), false);
    assert.equal(everyStoredText(f.db).includes('durable@example.invalid'), false);
  } finally {
    f.db.raw.close();
  }
});

for (const ambiguous of [false, true]) {
  void test(`interrupted signup erasure includes selection within the production query limit; ambiguous=${ambiguous}`, async () => {
    const f = await fixture();
    try {
      if (ambiguous) f.ambiguous();
      else f.beforeWrite(async () => f.people.deletePerson(f.person.id));
      assert.equal(
        (await reconcileBeehiivPerson(f.db, f.person.id, f.options)).kind,
        ambiguous ? 'retry' : 'stale',
      );
      if (ambiguous) await f.people.deletePerson(f.person.id);
      const budget = queryBudget(f.db, 50);
      assert.deepEqual(await pendingNewsletterPeople(budget.db, f.now, 1), [f.person.id]);
      assert.equal(
        (await reconcileBeehiivPerson(budget.db, f.person.id, { ...f.options, targetLimit: 1 }))
          .kind,
        'confirmed',
      );
      assert.ok(budget.queries <= 50);
      assert.equal(f.subscriptions.has('sub_created'), false);
    } finally {
      f.db.raw.close();
    }
  });
}

void test('an adopted subscription does not leave its previous erased owner blocked by a historical receipt', async () => {
  const f = await fixture();
  try {
    await reconcileBeehiivPerson(f.db, f.person.id, f.options);
    await f.people.deletePerson(f.person.id);
    const { person: replacement } = await f.people.upsertFromSource({
      source: 'join_form',
      fields: { email: 'durable@example.invalid' },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    });
    assert.equal((await reconcileBeehiivPerson(f.db, f.person.id, f.options)).kind, 'needs_review');
    assert.equal((await reconcileBeehiivPerson(f.db, replacement.id, f.options)).kind, 'confirmed');
    assert.equal(
      (await reconcileBeehiivPerson(f.db, f.person.id, { ...f.options, targetLimit: 1 })).kind,
      'confirmed',
    );
    assert.equal(f.subscriptions.get('sub_created')?.status, 'active');
    assert.equal(
      f.calls.some((call) => call.method === 'DELETE'),
      false,
    );
  } finally {
    f.db.raw.close();
  }
});
