import assert from 'node:assert/strict';
import test from 'node:test';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import { memoryDb } from './support/db';
import { PersonService } from '../src/person-service';
import { loadActor } from '../src/staff-roles';
import { confirmRosterSource } from '../src/roster-import-resolve';

async function fixture() {
  const db = memoryDb(),
    people = new PersonService(db);
  async function administrator(name: string) {
    const { person } = await people.upsertFromSource({
      source: 'join_form',
      fields: { email: `${name}@example.invalid` },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'synthetic',
      },
    });
    db.raw
      .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
      .run(person.id, 'synthetic', new Date().toISOString());
    return person;
  }
  const admin = await administrator('admin');
  await administrator('backup');
  const { person } = await people.upsertFromSource({
    source: 'staff',
    fields: { email: 'target@example.invalid', given_name: 'Target' },
  });
  const evidence = JSON.stringify({
    source: 'beehiiv',
    sourceId: 'sub_synthetic',
    email: 'target@example.invalid',
    newsletter: { state: 'active', givenAt: null, affirmative: false },
  });
  const evidenceHash = await digestToken(evidence);
  db.raw
    .prepare(
      "INSERT INTO roster_import_records(id,source,source_id,evidence_hash,person_id,suggested_person_id,state,reasons,evidence,recorded_at) VALUES('held','beehiiv','sub_synthetic',?,NULL,?,'held','[\"identity_match_unconfirmed\"]',?,?)",
    )
    .run(evidenceHash, person.id, evidence, new Date().toISOString());
  const actor = await loadActor(db, admin.id);
  assert.ok(actor);
  return {
    db,
    actor,
    person,
    input: {
      recordId: 'held',
      personId: person.id,
      personUpdatedAt: person.updated_at,
      evidenceHash,
      operationId: 'synthetic-confirm',
    },
  };
}
function mutations(db: ReturnType<typeof memoryDb>) {
  return db.raw
    .prepare(
      "SELECT (SELECT count(*) FROM identities WHERE platform='beehiiv' AND link_method='staff_confirmed') AS identities,(SELECT count(*) FROM staff_audits WHERE action='roster.source.confirm') AS audits,(SELECT count(*) FROM staff_operations WHERE kind='roster.source.confirm') AS operations",
    )
    .get();
}

void test('confirmation links only the exact suggested source once, without consent, membership or fabricated activity', async () => {
  const { db, actor, person, input } = await fixture();
  try {
    const before = db.raw
      .prepare(
        'SELECT (SELECT count(*) FROM people) AS people,(SELECT count(*) FROM consent_records) AS consents,(SELECT count(*) FROM engagement_events) AS events',
      )
      .get();
    assert.equal((await confirmRosterSource(db, actor, input)).kind, 'applied');
    assert.equal((await confirmRosterSource(db, actor, input)).kind, 'already_applied');
    assert.deepEqual({ ...mutations(db) }, { identities: 1, audits: 1, operations: 1 });
    const identity = db.raw
      .prepare(
        "SELECT person_id,external_email,link_method FROM identities WHERE platform='beehiiv' AND external_id='sub_synthetic'",
      )
      .get();
    assert.equal(identity?.person_id, person.id);
    assert.equal(identity.external_email, 'target@example.invalid');
    assert.equal(identity.link_method, 'staff_confirmed');
    const receipt = db.raw
      .prepare("SELECT person_id,state,evidence_hash FROM roster_import_records WHERE id='held'")
      .get();
    assert.equal(receipt?.person_id, person.id);
    assert.equal(receipt.state, 'held');
    assert.equal(receipt.evidence_hash, input.evidenceHash);
    assert.deepEqual(
      db.raw
        .prepare(
          'SELECT (SELECT count(*) FROM people) AS people,(SELECT count(*) FROM consent_records) AS consents,(SELECT count(*) FROM engagement_events) AS events',
        )
        .get(),
      before,
    );
    assert.equal(
      db.raw.prepare('SELECT membership_status FROM people WHERE id=?').get(person.id)
        ?.membership_status,
      'not_member',
    );
    const audit = db.raw
      .prepare(
        "SELECT actor_id,target_id,details FROM staff_audits WHERE action='roster.source.confirm'",
      )
      .get();
    assert.equal(audit?.actor_id, actor.personId);
    assert.equal(audit.target_id, person.id);
    assert.deepEqual(JSON.parse(String(audit.details)), { recordId: 'held' });
    assert.equal(
      (await confirmRosterSource(db, actor, { ...input, evidenceHash: 'f'.repeat(64) })).kind,
      'stale',
    );
    assert.deepEqual({ ...mutations(db) }, { identities: 1, audits: 1, operations: 1 });
  } finally {
    db.raw.close();
  }
});

void test('forged and revoked administrator authority cannot attach a source or create a confirmation receipt', async () => {
  for (const revoke of [false, true]) {
    const { db, actor, person, input } = await fixture();
    try {
      if (revoke)
        db.raw.prepare('DELETE FROM staff_administrators WHERE person_id=?').run(actor.personId);
      const submittedActor = revoke ? actor : { ...actor, personId: person.id };
      assert.equal((await confirmRosterSource(db, submittedActor, input)).kind, 'forbidden');
      assert.deepEqual({ ...mutations(db) }, { identities: 0, audits: 0, operations: 0 });
      assert.equal(
        db.raw.prepare("SELECT person_id FROM roster_import_records WHERE id='held'").get()
          ?.person_id,
        null,
      );
    } finally {
      db.raw.close();
    }
  }
});

void test('a stale evidence hash, changed displayed target or forged suggestion fails closed', async () => {
  for (const change of ['hash', 'updated', 'target', 'erased', 'claimed', 'reason', 'duplicate']) {
    const { db, actor, person, input } = await fixture();
    try {
      if (change === 'erased')
        db.raw
          .prepare('UPDATE person_keys SET deleted_at=?,erased_at=? WHERE id=?')
          .run(new Date().toISOString(), new Date().toISOString(), person.id);
      if (change === 'claimed')
        db.raw
          .prepare(
            "INSERT INTO identities(id,person_id,platform,external_id,external_email,linked_at,link_method,created_at,updated_at) VALUES('claimed',?,'beehiiv','sub_synthetic','target@example.invalid',?,'created_by_platform',?,?)",
          )
          .run(
            actor.personId,
            '2026-01-01T00:00:00.000Z',
            '2026-01-01T00:00:00.000Z',
            '2026-01-01T00:00:00.000Z',
          );
      if (change === 'reason')
        db.raw
          .prepare("UPDATE roster_import_records SET reasons='[\"needs_review\"]' WHERE id='held'")
          .run();
      if (change === 'duplicate')
        db.raw
          .prepare('UPDATE people SET email=? WHERE id=?')
          .run('TARGET@example.invalid', actor.personId);
      const stale = {
        ...input,
        ...(change === 'hash' ? { evidenceHash: 'f'.repeat(64) } : {}),
        ...(change === 'updated' ? { personUpdatedAt: '2020-01-01T00:00:00.000Z' } : {}),
        ...(change === 'target' ? { personId: actor.personId } : {}),
      };
      assert.equal((await confirmRosterSource(db, actor, stale)).kind, 'stale');
      assert.deepEqual({ ...mutations(db) }, { identities: 0, audits: 0, operations: 0 });
    } finally {
      db.raw.close();
    }
  }
});

void test('target, source ownership, erasure and administrator races are rechecked inside the confirmation batch', async () => {
  for (const change of ['email', 'claimed', 'erased', 'admin']) {
    const { db, actor, person, input } = await fixture();
    try {
      const original = db.batch.bind(db);
      let raced = false;
      db.batch = async (statements) => {
        if (!raced) {
          raced = true;
          if (change === 'email')
            db.raw
              .prepare('UPDATE people SET email=?,updated_at=? WHERE id=?')
              .run('changed@example.invalid', new Date().toISOString(), person.id);
          if (change === 'admin')
            db.raw
              .prepare('DELETE FROM staff_administrators WHERE person_id=?')
              .run(actor.personId);
          if (change === 'erased')
            db.raw
              .prepare('UPDATE person_keys SET deleted_at=?,erased_at=? WHERE id=?')
              .run(new Date().toISOString(), new Date().toISOString(), person.id);
          if (change === 'claimed')
            db.raw
              .prepare(
                "INSERT INTO identities(id,person_id,platform,external_id,external_email,linked_at,link_method,created_at,updated_at) VALUES('claimed',?,'beehiiv','sub_synthetic','target@example.invalid',?,'created_by_platform',?,?)",
              )
              .run(
                actor.personId,
                '2026-01-01T00:00:00.000Z',
                '2026-01-01T00:00:00.000Z',
                '2026-01-01T00:00:00.000Z',
              );
        }
        return original(statements);
      };
      const result = await confirmRosterSource(db, actor, input);
      assert.equal(raced, true);
      assert.ok(result.kind === 'stale' || result.kind === 'forbidden');
      assert.deepEqual({ ...mutations(db) }, { identities: 0, audits: 0, operations: 0 });
    } finally {
      db.raw.close();
    }
  }
});

void test('a failed audit rolls back source attachment, ledger assignment and idempotence receipt together', async () => {
  const { db, actor, input } = await fixture();
  try {
    db.raw.exec(
      "CREATE TRIGGER fail_source_confirmation BEFORE INSERT ON staff_audits WHEN NEW.action='roster.source.confirm' BEGIN SELECT RAISE(ABORT,'synthetic_confirmation_failure'); END",
    );
    await assert.rejects(confirmRosterSource(db, actor, input), /synthetic_confirmation_failure/);
    assert.deepEqual({ ...mutations(db) }, { identities: 0, audits: 0, operations: 0 });
    assert.equal(
      db.raw.prepare("SELECT person_id FROM roster_import_records WHERE id='held'").get()
        ?.person_id,
      null,
    );
  } finally {
    db.raw.close();
  }
});

void test('an existing unfinished operation cannot bypass the new source snapshot guard', async () => {
  const { db, actor, input } = await fixture();
  try {
    const payload = JSON.stringify({
      recordId: input.recordId,
      evidenceHash: input.evidenceHash,
      personUpdatedAt: input.personUpdatedAt,
    });
    db.raw
      .prepare(
        "INSERT INTO staff_operations(operation_id,actor_id,kind,target_id,payload,created_at) VALUES(?,?,'roster.source.confirm',?,?,?)",
      )
      .run(input.operationId, actor.personId, input.personId, payload, new Date().toISOString());
    assert.equal((await confirmRosterSource(db, actor, input)).kind, 'stale');
    assert.equal(
      db.raw.prepare("SELECT count(*) AS n FROM identities WHERE platform='beehiiv'").get()?.n,
      0,
    );
    assert.equal(
      db.raw
        .prepare("SELECT count(*) AS n FROM staff_audits WHERE action='roster.source.confirm'")
        .get()?.n,
      0,
    );
  } finally {
    db.raw.close();
  }
});

void test('confirmation does not complete an unrelated pending staff operation', async () => {
  const { db, actor, input } = await fixture();
  try {
    db.raw
      .prepare(
        "INSERT INTO staff_operations(operation_id,actor_id,kind,target_id,payload,created_at) VALUES('unrelated',?,'synthetic.pending',?,'{}',?)",
      )
      .run(actor.personId, input.personId, new Date().toISOString());
    assert.equal((await confirmRosterSource(db, actor, input)).kind, 'applied');
    assert.equal(
      db.raw.prepare("SELECT applied_at FROM staff_operations WHERE operation_id='unrelated'").get()
        ?.applied_at,
      null,
    );
  } finally {
    db.raw.close();
  }
});
