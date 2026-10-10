import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';

async function fixture() {
  const loaded = await import('../src/provider-completion').catch(() => null);
  assert.ok(loaded, 'shared operations need provider-aware completion');
  const db = memoryDb();
  const now = new Date('2026-10-09T10:00:00.000Z');
  db.raw
    .prepare('INSERT INTO people(id,created_at,updated_at) VALUES(?,?,?)')
    .run('person', now.toISOString(), now.toISOString());
  db.raw
    .prepare(
      "INSERT INTO reconcile_generations(person_id,target_id,generation) VALUES('person','person',1)",
    )
    .run();
  db.raw
    .prepare(
      "INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at) VALUES('ready','person_reconcile','person','person',1,'{}',?,?,?)",
    )
    .run(now.toISOString(), now.toISOString(), now.toISOString());
  return { ...loaded, db, now };
}

function link(
  db: ReturnType<typeof memoryDb>,
  platform: 'discord' | 'google_workspace',
  method = 'self_linked',
) {
  const stamp = '2026-10-09T09:00:00.000Z';
  db.raw
    .prepare(
      'INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
    )
    .run(
      `${platform}-identity`,
      'person',
      platform,
      `${platform}-external`,
      stamp,
      method,
      stamp,
      stamp,
    );
}

function receipt(
  db: ReturnType<typeof memoryDb>,
  provider: 'discord' | 'google_workspace',
  observedAt = '2026-10-09T09:59:00.000Z',
  expiresAt = '2026-10-09T10:04:00.000Z',
) {
  db.raw
    .prepare(
      "INSERT INTO provider_operation_receipts(operation_id,provider,state,failure,revision_hash,lease_token,observed_at,expires_at) VALUES('ready',?,'done',NULL,'revision','lease',?,?)",
    )
    .run(provider, observedAt, expiresAt);
}

void test('operations with no verified provider links complete while stale or future work stays open', async () => {
  const { db, now, completeProviderOperations } = await fixture();
  db.raw
    .prepare(
      "INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,state,next_attempt_at,created_at,updated_at) VALUES('stale','person_reconcile','person','person',0,'{}','queued',?,?,?)",
    )
    .run(now.toISOString(), now.toISOString(), now.toISOString());
  db.raw
    .prepare(
      "INSERT INTO integration_outbox(id,kind,person_id,target_id,generation,payload,next_attempt_at,created_at,updated_at) VALUES('future','person_reconcile','person','person',1,'{}',?,?,?)",
    )
    .run('2026-10-09T10:01:00.000Z', now.toISOString(), now.toISOString());

  assert.equal(await completeProviderOperations(db, { now, limit: 10 }), 1);
  assert.equal(
    db.raw.prepare("SELECT state FROM integration_outbox WHERE id='ready'").get()?.state,
    'done',
  );
  assert.equal(
    db.raw.prepare("SELECT state FROM integration_outbox WHERE id='stale'").get()?.state,
    'queued',
  );
  assert.equal(
    db.raw.prepare("SELECT state FROM integration_outbox WHERE id='future'").get()?.state,
    'queued',
  );
  db.raw.close();
});

void test('completion waits for every verified provider and requires a fresh receipt for each', async () => {
  const { db, now, completeProviderOperations } = await fixture();
  link(db, 'discord');
  link(db, 'google_workspace');
  receipt(db, 'discord');

  assert.equal(await completeProviderOperations(db, { now }), 0);
  assert.equal(
    db.raw.prepare("SELECT state FROM integration_outbox WHERE id='ready'").get()?.state,
    'queued',
  );

  receipt(db, 'google_workspace');
  assert.equal(await completeProviderOperations(db, { now }), 1);
  assert.equal(
    db.raw.prepare("SELECT state FROM integration_outbox WHERE id='ready'").get()?.state,
    'done',
  );
  db.raw.close();
});

void test('expired, future-dated, and retry receipts cannot complete a linked provider', async () => {
  const { db, now, completeProviderOperations } = await fixture();
  link(db, 'discord');
  receipt(db, 'discord', '2026-10-09T10:01:00.000Z', '2026-10-09T10:04:00.000Z');

  assert.equal(await completeProviderOperations(db, { now }), 0);
  db.raw
    .prepare(
      "UPDATE provider_operation_receipts SET observed_at='2026-10-09T09:59:00.000Z',expires_at=? WHERE operation_id='ready'",
    )
    .run(now.toISOString());
  assert.equal(await completeProviderOperations(db, { now }), 0);
  db.raw
    .prepare(
      "UPDATE provider_operation_receipts SET state='retry',failure='provider_unavailable',expires_at='2026-10-09T10:04:00.000Z' WHERE operation_id='ready'",
    )
    .run();

  assert.equal(await completeProviderOperations(db, { now }), 0);
  assert.equal(
    db.raw.prepare("SELECT state FROM integration_outbox WHERE id='ready'").get()?.state,
    'queued',
  );
  db.raw.close();
});

void test('an unverified provider identity keeps shared work open for review', async () => {
  const { db, now, completeProviderOperations } = await fixture();
  link(db, 'google_workspace', 'verified_email');

  assert.equal(await completeProviderOperations(db, { now }), 0);
  assert.equal(
    db.raw.prepare("SELECT state FROM integration_outbox WHERE id='ready'").get()?.state,
    'queued',
  );
  db.raw.close();
});

void test('multiple provider identities cannot share one provider receipt', async () => {
  const { db, now, completeProviderOperations } = await fixture();
  link(db, 'discord');
  db.raw
    .prepare(
      "INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at) VALUES('discord-second','person','discord','discord-second-external','2026-10-09T09:00:00.000Z','staff_confirmed','2026-10-09T09:00:00.000Z','2026-10-09T09:00:00.000Z')",
    )
    .run();
  receipt(db, 'discord');

  assert.equal(await completeProviderOperations(db, { now }), 0);
  assert.equal(
    db.raw.prepare("SELECT state FROM integration_outbox WHERE id='ready'").get()?.state,
    'queued',
  );
  db.raw.close();
});

void test('an identity for an unsupported provider keeps shared work open', async () => {
  const { db, now, completeProviderOperations } = await fixture();
  db.raw
    .prepare(
      "INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at) VALUES('beehiiv-identity','person','beehiiv','beehiiv-external','2026-10-09T09:00:00.000Z','created_by_platform','2026-10-09T09:00:00.000Z','2026-10-09T09:00:00.000Z')",
    )
    .run();

  assert.equal(await completeProviderOperations(db, { now }), 0);
  assert.equal(
    db.raw.prepare("SELECT state FROM integration_outbox WHERE id='ready'").get()?.state,
    'queued',
  );
  db.raw.close();
});
