import { fixture } from './support/beehiiv-sync-fixture';
import assert from 'node:assert/strict';
import test from 'node:test';
import { everyStoredText } from '@lasvegasfortransit/platform-storage/test-db';
import { randomToken } from '@lasvegasfortransit/platform-core/random-token';
import { NewsletterIntentCipher } from '../src/newsletter-intent-cipher';

async function runner() {
  const module = await import('../src/beehiiv-sync').catch(() => null);
  assert.ok(module, 'Accepted newsletter requests need a durable provider runner');
  return module.reconcileBeehiivPerson;
}

void test('selecting and delivering a fresh account fits the Free invocation query budget', async () => {
  const f = await fixture();
  try {
    const budgetModule = await import('@lasvegasfortransit/platform-storage/query-budget').catch(
      () => null,
    );
    assert.ok(budgetModule, 'Compiled account runs need an enforced query budget');
    const budget = budgetModule.queryBudget(f.db, 50);
    const pending = await import('@lasvegasfortransit/platform-storage/newsletter-sync-store');
    assert.deepEqual(await pending.pendingNewsletterPeople(budget.db, f.now, 1), [f.person.id]);
    assert.equal(
      (await (await runner())(budget.db, f.person.id, { ...f.options, targetLimit: 1 })).kind,
      'confirmed',
    );
    assert.ok(budget.queries <= 50);
    assert.ok(budget.largestBindings <= 100);
  } finally {
    f.db.raw.close();
  }
});

void test('a fresh join is confirmed independently and retains no clear-text remote intent', async () => {
  const f = await fixture();
  try {
    const reconcile = await runner();
    assert.equal((await reconcile(f.db, f.person.id, f.options)).kind, 'confirmed');
    assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1);
    assert.ok(f.calls.some((call) => call.method === 'GET' && call.path.includes('/by_email/')));
    assert.equal(
      f.db.raw.prepare("SELECT external_id FROM identities WHERE platform='beehiiv'").get()
        ?.external_id,
      'sub_created',
    );
    assert.equal(f.db.raw.prepare('SELECT state FROM newsletter_sync_jobs').get()?.state, 'done');
    assert.equal(
      f.db.raw.prepare('SELECT count(*) AS n FROM newsletter_write_intents').get()?.n,
      0,
    );
    assert.equal((await reconcile(f.db, f.person.id, f.options)).kind, 'busy');
    assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1);
  } finally {
    f.db.raw.close();
  }
});

void test('partial revocation resumes remaining subscriptions and honors a publication-wide rate limit', async () => {
  const f = await fixture();
  try {
    const reconcile = await runner();
    for (const id of ['sub_old_a', 'sub_old_b']) {
      const email = `${id}@example.invalid`;
      await f.people.linkIdentity(f.person.id, {
        platform: 'beehiiv',
        externalId: id,
        externalEmail: email,
        linkMethod: 'created_by_platform',
      });
      f.subscriptions.set(id, {
        id,
        email,
        status: 'active',
        created: Math.floor(f.now.getTime() / 1000) - 60,
      });
    }
    await f.people.withdrawConsent(f.person.id, {
      scope: 'newsletter',
      source: 'account',
      withdrawnAt: new Date().toISOString(),
    });
    const original = f.options.fetcher;
    let limited = true;
    f.options.fetcher = (input, init) => {
      assert.ok(typeof input === 'string');
      if (limited && init?.method === 'PATCH' && input.endsWith('/sub_old_b')) {
        limited = false;
        f.calls.push({ method: 'PATCH', path: new URL(input).pathname });
        return Promise.resolve(
          new Response(null, { status: 429, headers: { 'Retry-After': '1.25' } }),
        );
      }
      return original(input, init);
    };
    assert.equal((await reconcile(f.db, f.person.id, f.options)).kind, 'retry');
    const before = f.calls.length;
    f.now.setTime(f.now.getTime() + 1000);
    assert.equal((await reconcile(f.db, f.person.id, f.options)).kind, 'retry');
    assert.equal(f.calls.length, before);
    f.now.setTime(f.now.getTime() + 251);
    assert.equal((await reconcile(f.db, f.person.id, f.options)).kind, 'confirmed');
    assert.equal(
      f.calls.filter((call) => call.method === 'PATCH' && call.path.endsWith('/sub_old_a')).length,
      1,
    );
    assert.equal(f.subscriptions.get('sub_old_b')?.status, 'inactive');
    assert.equal(
      f.calls.some((call) => call.method === 'POST'),
      false,
    );
  } finally {
    f.db.raw.close();
  }
});

void test('bounded revocation advances through old addresses across fresh runner instances', async () => {
  const f = await fixture();
  try {
    const reconcile = await runner();
    for (const id of ['sub_bounded_a', 'sub_bounded_b']) {
      const email = `${id}@example.invalid`;
      await f.people.linkIdentity(f.person.id, {
        platform: 'beehiiv',
        externalId: id,
        externalEmail: email,
        linkMethod: 'created_by_platform',
      });
      f.subscriptions.set(id, {
        id,
        email,
        status: 'active',
        created: Math.floor(f.now.getTime() / 1000) - 60,
      });
    }
    await f.people.withdrawConsent(f.person.id, {
      scope: 'newsletter',
      source: 'account',
      withdrawnAt: new Date().toISOString(),
    });
    const options = { ...f.options, targetLimit: 1 };
    assert.equal((await reconcile(f.db, f.person.id, options)).kind, 'progress');
    f.now.setTime(f.now.getTime() + 360_000);
    assert.equal((await reconcile(f.db, f.person.id, options)).kind, 'progress');
    assert.equal((await reconcile(f.db, f.person.id, options)).kind, 'confirmed');
    assert.equal(f.calls.filter((call) => call.method === 'PATCH').length, 2);
    assert.equal(
      f.calls.filter((call) => call.method === 'GET' && call.path.endsWith('/sub_bounded_a'))
        .length,
      2,
      'completed targets must not starve later targets after a restart',
    );
    assert.equal(f.db.raw.prepare('SELECT state FROM newsletter_sync_jobs').get()?.state, 'done');
  } finally {
    f.db.raw.close();
  }
});

void test('malformed retained provider IDs require review without blocking the dispatcher', async () => {
  const f = await fixture();
  try {
    const reconcile = await runner();
    await f.people.linkIdentity(f.person.id, {
      platform: 'beehiiv',
      externalId: 'legacy-id-without-provider-prefix',
      externalEmail: 'durable@example.invalid',
      linkMethod: 'staff_confirmed',
    });
    await f.people.withdrawConsent(f.person.id, {
      scope: 'newsletter',
      source: 'account',
      withdrawnAt: new Date().toISOString(),
    });
    assert.equal((await reconcile(f.db, f.person.id, f.options)).kind, 'needs_review');
    assert.equal(f.calls.length, 0);
  } finally {
    f.db.raw.close();
  }
});

void test('recovery rejects a different encryption key without transmitting the erased address', async () => {
  const f = await fixture();
  try {
    const reconcile = await runner();
    f.ambiguous();
    assert.equal((await reconcile(f.db, f.person.id, f.options)).kind, 'retry');
    await f.people.deletePerson(f.person.id);
    const before = f.calls.length;
    assert.equal(
      (await reconcile(f.db, f.person.id, { ...f.options, intentKey: randomToken() })).kind,
      'needs_review',
    );
    assert.equal(f.calls.length, before);
    assert.equal(everyStoredText(f.db).includes('durable@example.invalid'), false);
    assert.equal(
      f.db.raw.prepare('SELECT count(*) AS n FROM newsletter_write_intents').get()?.n,
      1,
    );
  } finally {
    f.db.raw.close();
  }
});

void test('historical consent cannot silently reactivate an externally inactive subscription', async () => {
  const f = await fixture('import');
  try {
    const reconcile = await runner();
    f.subscriptions.set('sub_historical', {
      id: 'sub_historical',
      email: 'durable@example.invalid',
      status: 'inactive',
      created: Math.floor(f.now.getTime() / 1000) - 60,
    });
    assert.equal((await reconcile(f.db, f.person.id, f.options)).kind, 'needs_review');
    assert.equal(
      f.calls.some((call) => call.method === 'POST'),
      false,
    );
    assert.equal(
      f.db.raw.prepare('SELECT last_failure FROM newsletter_sync_jobs').get()?.last_failure,
      'consent_evidence_needed',
    );
  } finally {
    f.db.raw.close();
  }
});

void test('an erased account can move to its new consenting owner without old cleanup revoking it', async () => {
  const f = await fixture();
  try {
    const reconcile = await runner();
    await f.people.linkIdentity(f.person.id, {
      platform: 'beehiiv',
      externalId: 'sub_reused',
      externalEmail: 'durable@example.invalid',
      linkMethod: 'created_by_platform',
    });
    f.subscriptions.set('sub_reused', {
      id: 'sub_reused',
      email: 'durable@example.invalid',
      status: 'active',
      created: Math.floor(f.now.getTime() / 1000) - 60,
    });
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
    assert.equal((await reconcile(f.db, f.person.id, f.options)).kind, 'needs_review');
    assert.equal(
      f.calls.some((call) => call.method === 'PATCH'),
      false,
    );
    assert.equal((await reconcile(f.db, replacement.id, f.options)).kind, 'confirmed');
    assert.equal((await reconcile(f.db, f.person.id, f.options)).kind, 'confirmed');
    assert.equal(f.subscriptions.get('sub_reused')?.status, 'active');
    assert.equal(
      f.calls.some((call) => call.method === 'DELETE'),
      false,
    );
    assert.equal(
      f.db.raw.prepare("SELECT person_id FROM identities WHERE external_id='sub_reused'").get()
        ?.person_id,
      replacement.id,
    );
  } finally {
    f.db.raw.close();
  }
});

void test('failed intent persistence prevents the remote write and leaves the request retryable', async () => {
  const f = await fixture();
  try {
    const reconcile = await runner();
    f.db.raw.exec(
      "CREATE TRIGGER reject_newsletter_intent BEFORE INSERT ON newsletter_write_intents BEGIN SELECT RAISE(ABORT,'fixture intent failure'); END",
    );
    await assert.rejects(reconcile(f.db, f.person.id, f.options), /fixture intent failure/);
    assert.equal(
      f.calls.some((call) => call.method === 'POST'),
      false,
    );
    f.db.raw.exec('DROP TRIGGER reject_newsletter_intent');
    assert.equal((await reconcile(f.db, f.person.id, f.options)).kind, 'confirmed');
  } finally {
    f.db.raw.close();
  }
});

void test('withdrawal during a remote grant retains its ID for cleanup without restoring an erased profile', async () => {
  const f = await fixture();
  try {
    const reconcile = await runner();
    f.beforeWrite(async () => {
      await f.people.withdrawConsent(f.person.id, {
        scope: 'newsletter',
        source: 'account',
        withdrawnAt: new Date().toISOString(),
      });
      await f.people.deletePerson(f.person.id);
    });
    assert.equal((await reconcile(f.db, f.person.id, f.options)).kind, 'stale');
    assert.equal(await f.people.getPerson(f.person.id), null);
    assert.equal(
      f.db.raw.prepare('SELECT subscription_id FROM newsletter_write_intents').get()
        ?.subscription_id,
      'sub_created',
    );
    assert.equal(everyStoredText(f.db).includes('durable@example.invalid'), false);
    assert.equal((await reconcile(f.db, f.person.id, f.options)).kind, 'confirmed');
    assert.equal(f.subscriptions.has('sub_created'), false);
    assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1);
    assert.equal(
      f.db.raw.prepare('SELECT count(*) AS n FROM newsletter_write_intents').get()?.n,
      0,
    );
    assert.equal(everyStoredText(f.db).includes('durable@example.invalid'), false);
  } finally {
    f.db.raw.close();
  }
});

void test('an ambiguous creation survives restart and erasure using only an encrypted address', async () => {
  const f = await fixture();
  try {
    const reconcile = await runner();
    f.ambiguous();
    assert.equal((await reconcile(f.db, f.person.id, f.options)).kind, 'retry');
    await f.people.deletePerson(f.person.id);
    const intent = f.db.raw
      .prepare('SELECT encrypted_email,subscription_id FROM newsletter_write_intents')
      .get();
    assert.equal(typeof intent?.encrypted_email, 'string');
    assert.equal(intent?.subscription_id, null);
    assert.equal(everyStoredText(f.db).includes('durable@example.invalid'), false);
    assert.equal((await reconcile(f.db, f.person.id, f.options)).kind, 'confirmed');
    assert.equal(f.subscriptions.has('sub_created'), false);
    assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1);
    assert.equal(
      f.db.raw.prepare('SELECT count(*) AS n FROM newsletter_write_intents').get()?.n,
      0,
    );
  } finally {
    f.db.raw.close();
  }
});

void test('an expired worker cannot attach a late grant or overwrite its successor cleanup', async () => {
  const f = await fixture();
  try {
    const reconcile = await runner();
    f.beforeWrite(async () => {
      await f.people.deletePerson(f.person.id);
      f.now.setTime(f.now.getTime() + 31_000);
      assert.equal((await reconcile(f.db, f.person.id, f.options)).kind, 'retry');
    });
    assert.equal((await reconcile(f.db, f.person.id, f.options)).kind, 'stale');
    assert.equal(await f.people.getPerson(f.person.id), null);
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM identities').get()?.n, 0);
    f.now.setTime(f.now.getTime() + 61_000);
    assert.equal((await reconcile(f.db, f.person.id, f.options)).kind, 'confirmed');
    assert.equal(f.subscriptions.has('sub_created'), false);
    assert.equal(everyStoredText(f.db).includes('durable@example.invalid'), false);
  } finally {
    f.db.raw.close();
  }
});

void test('recovery ciphertext is bound to its original intent, publication and person', async () => {
  const cipher = new NewsletterIntentCipher(randomToken());
  const context = { id: 'intent', publicationId: 'pub_fixture', personId: 'person' };
  const value = await cipher.encrypt('encrypted@example.invalid', context);
  assert.equal(await cipher.decrypt(value, context), 'encrypted@example.invalid');
  for (const changed of [
    { ...context, id: 'another' },
    { ...context, publicationId: 'pub_other' },
    { ...context, personId: 'another' },
  ]) {
    await assert.rejects(cipher.decrypt(value, changed));
  }
  await assert.rejects(cipher.decrypt(value + '.extra', context));
  assert.equal(value.includes('encrypted@example.invalid'), false);
});
