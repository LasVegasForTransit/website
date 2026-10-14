import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { PersonService } from '../src/person-service';

async function store() {
  const module = await import('../src/newsletter-sync-store').catch(() => null);
  assert.ok(module, 'Newsletter requests need durable, fenced reconciliation');
  return module;
}

async function member(db: ReturnType<typeof memoryDb>, email = 'newsletter@example.invalid') {
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture-v1',
    },
  });
  await people.linkIdentity(person.id, {
    platform: 'beehiiv',
    externalId: 'sub_newsletter_fixture',
    externalEmail: email,
    linkMethod: 'created_by_platform',
  });
  return { people, person };
}

void test('consent ordering uses instants instead of timestamp text order', async () => {
  const db = memoryDb();
  try {
    const sync = await store();
    const people = new PersonService(db);
    const { person } = await people.upsertFromSource({
      source: 'staff',
      fields: { email: 'clock@example.invalid' },
    });
    await people.recordConsent(person.id, {
      scope: 'newsletter',
      source: 'account',
      method: 'checkbox',
      wordingVersion: 'fixture',
      givenAt: '2026-01-01T00:00:00.000Z',
    });
    await people.withdrawConsent(person.id, {
      scope: 'newsletter',
      source: 'account',
      withdrawnAt: '2026-01-01T12:00:00.000-08:00',
    });
    await people.recordConsent(person.id, {
      scope: 'newsletter',
      source: 'account',
      method: 'checkbox',
      wordingVersion: 'fixture',
      givenAt: '2026-01-01T15:00:00.000Z',
    });
    assert.equal((await sync.loadNewsletterPlan(db, person.id))?.allowActivation, false);
  } finally {
    db.raw.close();
  }
});

void test('moving a subscription invalidates its old plan and serializes the new owner', async () => {
  const db = memoryDb();
  try {
    const sync = await store();
    const { person: first, people } = await member(db);
    const { person: second } = await people.upsertFromSource({
      source: 'join_form',
      fields: { email: 'second-owner@example.invalid' },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    });
    const lease = await sync.claimNewsletterJob(db, first.id, 'pub_fixture', new Date());
    const old = await sync.loadNewsletterPlan(db, first.id);
    assert.ok(lease);
    assert.ok(old);
    db.raw
      .prepare("UPDATE identities SET person_id=? WHERE person_id=? AND platform='beehiiv'")
      .run(second.id, first.id);
    assert.equal(await sync.newsletterPlanIsCurrent(db, old, 'pub_fixture'), false);
    assert.equal(await sync.claimNewsletterJob(db, second.id, 'pub_fixture', new Date()), null);
    await sync.releaseNewsletterLease(db, lease);
    assert.ok(await sync.claimNewsletterJob(db, second.id, 'pub_fixture', new Date()));
  } finally {
    db.raw.close();
  }
});

void test('erasure invalidates grants while retaining stable subscription cleanup targets', async () => {
  const db = memoryDb();
  try {
    const sync = await store();
    const { person, people } = await member(db);
    const old = await sync.loadNewsletterPlan(db, person.id);
    assert.ok(old);
    await people.deletePerson(person.id);
    assert.equal(await sync.newsletterPlanIsCurrent(db, old, 'pub_fixture'), false);
    const cleanup = await sync.loadNewsletterPlan(db, person.id);
    assert.ok(cleanup);
    assert.equal(cleanup.desired, 'inactive');
    assert.equal(cleanup.email, null);
    const target = cleanup.identities[0];
    assert.ok(target);
    assert.equal(target.externalId, 'sub_newsletter_fixture');
    assert.equal(target.email, null);
  } finally {
    db.raw.close();
  }
});

void test('newsletter consent and its durable provider request commit together', async () => {
  const db = memoryDb();
  try {
    assert.ok(
      db.raw.prepare("SELECT 1 FROM sqlite_master WHERE name='newsletter_sync_jobs'").get(),
      'Newsletter consent needs an atomic outbox',
    );
    const { person } = await member(db);
    const job = db.raw
      .prepare('SELECT state,activation_consent_id FROM newsletter_sync_jobs WHERE person_id=?')
      .get(person.id);
    assert.equal(job?.state, 'queued');
    const consent = db.raw
      .prepare('SELECT id FROM consent_records WHERE person_id=? AND withdrawn_at IS NULL')
      .get(person.id);
    assert.equal(job.activation_consent_id, consent?.id);
    const { person: other } = await new PersonService(db).upsertFromSource({
      source: 'staff',
      fields: { email: 'rollback@example.invalid' },
    });
    db.raw.exec(
      "CREATE TRIGGER reject_newsletter_job BEFORE INSERT ON newsletter_sync_jobs WHEN NEW.person_id='" +
        other.id +
        "' BEGIN SELECT RAISE(ABORT,'outbox rejected'); END;",
    );
    await assert.rejects(
      () =>
        new PersonService(db).recordConsent(other.id, {
          scope: 'newsletter',
          source: 'account',
          method: 'checkbox',
          wordingVersion: 'fixture-v1',
          givenAt: new Date().toISOString(),
        }),
      /outbox rejected/,
    );
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM consent_records WHERE person_id=?').get(other.id)
        ?.n,
      0,
    );
    assert.equal(
      db.raw
        .prepare('SELECT count(*) AS n FROM newsletter_sync_jobs WHERE person_id=?')
        .get(other.id)?.n,
      0,
    );
  } finally {
    db.raw.close();
  }
});

void test('large linked profiles stay within invocation query and binding budgets', async () => {
  const db = memoryDb();
  try {
    const sync = await store();
    const { person } = await member(db);
    const stamp = new Date().toISOString();
    const insert = db.raw.prepare(
      `INSERT INTO identities(id,person_id,platform,external_id,external_email,link_method,linked_at,created_at,updated_at) VALUES(?,?,'beehiiv',?,?,'created_by_platform',?,?,?)`,
    );
    db.raw.exec('BEGIN');
    try {
      for (let index = 0; index < 1000; index++) {
        insert.run(
          `newsletter-large-${index}`,
          person.id,
          `sub_large_${index}`,
          `large-${index}@example.invalid`,
          stamp,
          stamp,
          stamp,
        );
      }
      db.raw.exec('COMMIT');
    } catch (error) {
      db.raw.exec('ROLLBACK');
      throw error;
    }
    const now = new Date();
    let queries = 0,
      largestBindings = 0;
    const measured = {
      ...db,
      prepare: (sql: string) => {
        queries++;
        const statement = db.prepare(sql),
          bind = statement.bind.bind(statement);
        statement.bind = (...values) => {
          largestBindings = Math.max(largestBindings, values.length);
          return bind(...values);
        };
        return statement;
      },
    };
    const lease = await sync.claimNewsletterJob(measured, person.id, 'pub_fixture', now);
    const plan = await sync.loadNewsletterPlan(measured, person.id);
    assert.ok(lease);
    assert.ok(plan);
    assert.equal(lease.accountKeys.length, 2002);
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM newsletter_account_leases').get()?.n,
      2002,
    );
    assert.equal(
      await sync.saveNewsletterOutcome(measured, plan, lease, { kind: 'confirmed', now }),
      true,
    );
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM newsletter_account_leases').get()?.n, 0);
    assert.ok(queries < 50, `${queries} queries exceeded the invocation budget`);
    assert.ok(largestBindings <= 100);
  } finally {
    db.raw.close();
  }
});

void test('a withdrawal supersedes a delayed grant while retaining its active account lease', async () => {
  const db = memoryDb();
  try {
    const sync = await store();
    const { person, people } = await member(db);
    const now = new Date();
    const lease = await sync.claimNewsletterJob(db, person.id, 'pub_fixture', now);
    assert.ok(lease);
    const plan = await sync.loadNewsletterPlan(db, person.id);
    assert.ok(plan);
    assert.equal(plan.desired, 'active');
    assert.equal(plan.allowActivation, true);
    await people.withdrawConsent(person.id, {
      scope: 'newsletter',
      source: 'account',
      withdrawnAt: new Date().toISOString(),
    });
    assert.equal(await sync.newsletterPlanIsCurrent(db, plan, 'pub_fixture'), false);
    assert.equal(
      await sync.saveNewsletterOutcome(db, plan, lease, { kind: 'confirmed', now: new Date() }),
      false,
    );
    assert.equal(
      db.raw.prepare('SELECT state FROM newsletter_sync_jobs WHERE person_id=?').get(person.id)
        ?.state,
      'queued',
    );
    assert.equal(await sync.claimNewsletterJob(db, person.id, 'pub_fixture', new Date()), null);
    await sync.releaseNewsletterLease(db, lease);
    const next = await sync.claimNewsletterJob(db, person.id, 'pub_fixture', new Date());
    assert.ok(next);
    const withdrawn = await sync.loadNewsletterPlan(db, person.id);
    assert.ok(withdrawn);
    assert.equal(withdrawn.desired, 'inactive');
    assert.equal(withdrawn.allowActivation, false);
  } finally {
    db.raw.close();
  }
});

void test('an expired lease cannot clear a new owner or save a stale receipt', async () => {
  const db = memoryDb();
  try {
    const sync = await store();
    const { person } = await member(db);
    const now = new Date();
    const first = await sync.claimNewsletterJob(db, person.id, 'pub_fixture', now);
    const plan = await sync.loadNewsletterPlan(db, person.id);
    assert.ok(first);
    assert.ok(plan);
    const later = new Date(now.getTime() + 31_000);
    const second = await sync.claimNewsletterJob(db, person.id, 'pub_fixture', later);
    assert.ok(second);
    await sync.releaseNewsletterLease(db, first);
    assert.equal(
      await sync.saveNewsletterOutcome(db, plan, first, { kind: 'confirmed', now: later }),
      false,
    );
    assert.equal(
      await sync.saveNewsletterOutcome(db, plan, second, { kind: 'confirmed', now: later }),
      true,
    );
    assert.equal(
      db.raw
        .prepare('SELECT state,activation_consent_id FROM newsletter_sync_jobs WHERE person_id=?')
        .get(person.id)?.state,
      'done',
    );
    assert.equal(
      db.raw
        .prepare('SELECT activation_consent_id FROM newsletter_sync_jobs WHERE person_id=?')
        .get(person.id)?.activation_consent_id,
      null,
    );
  } finally {
    db.raw.close();
  }
});

void test('missing consent and historical imports never authorize reactivation', async () => {
  const db = memoryDb();
  try {
    const sync = await store();
    const people = new PersonService(db);
    const { person } = await people.upsertFromSource({
      source: 'staff',
      fields: { email: 'history@example.invalid' },
    });
    assert.ok(person.email);
    await people.linkIdentity(person.id, {
      platform: 'beehiiv',
      externalId: 'sub_history_fixture',
      externalEmail: person.email,
      linkMethod: 'staff_confirmed',
    });
    assert.equal((await sync.loadNewsletterPlan(db, person.id))?.desired, 'unknown');
    await people.recordConsent(person.id, {
      scope: 'newsletter',
      source: 'import',
      method: 'unknown',
      wordingVersion: 'fixture',
      givenAt: '2026-01-01T12:00:00.000Z',
    });
    const plan = await sync.loadNewsletterPlan(db, person.id);
    assert.equal(plan?.desired, 'active');
    assert.equal(plan.allowActivation, false);
  } finally {
    db.raw.close();
  }
});

void test('provider retries retain their deadline and the accepted consent after restarts', async () => {
  const db = memoryDb();
  try {
    const sync = await store();
    const { person } = await member(db);
    const now = new Date();
    const lease = await sync.claimNewsletterJob(db, person.id, 'pub_fixture', now);
    const plan = await sync.loadNewsletterPlan(db, person.id);
    assert.ok(lease);
    assert.ok(plan);
    assert.equal(
      await sync.saveNewsletterOutcome(db, plan, lease, {
        kind: 'retry',
        failure: 'rate_limited',
        retryAfterMs: 1250,
        now,
      }),
      true,
    );
    assert.equal((await new PersonService(db).getPerson(person.id))?.membership_status, 'member');
    assert.equal(
      await sync.claimNewsletterJob(db, person.id, 'pub_fixture', new Date(now.getTime() + 100)),
      null,
    );
    assert.ok(
      await sync.claimNewsletterJob(db, person.id, 'pub_fixture', new Date(now.getTime() + 1251)),
    );
  } finally {
    db.raw.close();
  }
});
