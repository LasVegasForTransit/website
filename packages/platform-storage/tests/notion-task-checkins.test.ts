import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMigrations } from './support/db';
import { deletePersonData } from '../src/person-deletion';
import { now, later, storage, fixture, ready, operation } from './support/task-checkins';

void test('Notion mappings cannot replace another person or conflate workspaces', async () => {
  const s = await storage();
  const db = fixture();
  try {
    const mapping = {
      workspaceId: 'a',
      notionUserId: 'user',
      personId: 'guest',
      confirmedBy: 'staff',
    };
    assert.equal(await s.putNotionTaskMapping(db, mapping, now), true);
    assert.equal(await s.putNotionTaskMapping(db, { ...mapping, personId: 'member' }, now), false);
    assert.equal(
      await s.putNotionTaskMapping(db, { ...mapping, notionUserId: 'other' }, now),
      false,
    );
    assert.equal(
      await s.putNotionTaskMapping(db, { ...mapping, workspaceId: 'b', personId: 'member' }, now),
      true,
    );
    assert.equal(
      db.raw.prepare('SELECT membership_status FROM people WHERE id=?').get('guest')
        ?.membership_status,
      'not_member',
    );
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM identities WHERE person_id=?').get('guest')?.n,
      0,
    );
    applyMigrations(db.raw);
    assert.deepEqual(db.raw.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.raw.close();
  }
});

void test('a delivery consent change supersedes unsent operations and cannot be replayed', async () => {
  const { s, db } = await ready();
  try {
    assert.equal(await s.recordTaskInteraction(db, operation, now), true);
    assert.equal(
      await s.setTaskCheckinConsent(
        db,
        {
          sourceId: 'source',
          personId: 'member',
          discordUserId: '111111111111111111',
          interactionId: '100000000000000100',
          state: 'opted_out',
          policyRevision: 1,
        },
        later,
      ),
      true,
    );
    assert.equal(
      await s.setTaskCheckinConsent(
        db,
        {
          sourceId: 'source',
          personId: 'member',
          discordUserId: '111111111111111111',
          interactionId: '100000000000000001',
          state: 'active',
          policyRevision: 1,
        },
        later,
      ),
      false,
    );
    assert.equal(await s.claimTaskOperation(db, 'operation', later), null);
    assert.equal(
      db.raw.prepare('SELECT state FROM task_checkin_operations').get()?.state,
      'superseded',
    );
  } finally {
    db.raw.close();
  }
});

void test('snapshot changes supersede stale work while delayed source state cannot replace newer state', async () => {
  const { s, db } = await ready();
  try {
    await s.recordTaskInteraction(db, operation, now);
    const next = {
      sourceId: 'source',
      taskId: 'task',
      revision: 'v2',
      sourceEditedAt: later.toISOString(),
      active: true,
      snapshot: { name: 'Prepare agenda', assigneeIds: [] },
    };
    assert.equal(await s.upsertNotionTaskSnapshot(db, next, later), true);
    assert.equal(
      await s.upsertNotionTaskSnapshot(
        db,
        { ...next, revision: 'v1', sourceEditedAt: now.toISOString() },
        later,
      ),
      false,
    );
    assert.equal(await s.claimTaskOperation(db, 'operation', later), null);
    assert.equal(db.raw.prepare('SELECT revision FROM task_checkin_tasks').get()?.revision, 'v2');
  } finally {
    db.raw.close();
  }
});

void test('duplicate receipts do not replace response text and concurrent workers cannot claim twice', async () => {
  const { s, db } = await ready();
  try {
    assert.equal(await s.recordTaskInteraction(db, operation, now), true);
    assert.equal(
      await s.recordTaskInteraction(db, { ...operation, payload: { text: 'overwrite' } }, now),
      false,
    );
    const claim = await s.claimTaskOperation(db, 'operation', now);
    assert.ok(claim);
    assert.equal(await s.claimTaskOperation(db, 'operation', now), null);
    const payload: unknown = JSON.parse(claim.payload_json);
    assert.deepEqual(payload, { text: 'Draft ready' });
    assert.equal(
      await s.completeTaskOperation(
        db,
        { id: claim.id, token: 'wrong' },
        { state: 'confirmed' },
        now,
      ),
      false,
    );
    assert.equal(
      await s.completeTaskOperation(
        db,
        { id: claim.id, token: claim.claim_token },
        { state: 'confirmed' },
        now,
      ),
      true,
    );
    assert.equal(await s.claimTaskOperation(db, 'operation', later), null);
  } finally {
    db.raw.close();
  }
});

void test('an interrupted effect is held rather than blindly retried after lease expiry', async () => {
  const { s, db } = await ready();
  try {
    await s.recordTaskInteraction(db, operation, now);
    const claim = await s.claimTaskOperation(db, 'operation', now);
    assert.ok(claim);
    assert.equal(await s.claimTaskOperation(db, 'operation', later), null);
    assert.equal(db.raw.prepare('SELECT state FROM task_checkin_operations').get()?.state, 'held');
    assert.equal(
      await s.completeTaskOperation(
        db,
        { id: claim.id, token: claim.claim_token },
        { state: 'confirmed' },
        later,
      ),
      false,
    );
  } finally {
    db.raw.close();
  }
});

void test('unlinked actors, old policy consent, and deleted people cannot authorize operations', async () => {
  const { s, db } = await ready();
  try {
    assert.equal(
      await s.setTaskCheckinConsent(
        db,
        {
          sourceId: 'source',
          personId: 'member',
          discordUserId: '222222222222222222',
          interactionId: '100000000000000998',
          state: 'active',
          policyRevision: 1,
        },
        now,
      ),
      false,
    );
    assert.equal(
      await s.recordTaskInteraction(db, { ...operation, policyRevision: 9 }, now),
      false,
    );
    await s.recordTaskInteraction(db, operation, now);
    db.raw.prepare('UPDATE people SET deleted_at=? WHERE id=?').run(now.toISOString(), 'member');
    assert.equal(await s.claimTaskOperation(db, 'operation', now), null);
  } finally {
    db.raw.close();
  }
});

void test('policy edits compare revisions and invalidate old consent and queued work', async () => {
  const { s, db } = await ready();
  try {
    await s.recordTaskInteraction(db, operation, now);
    const input = {
      sourceId: 'source',
      workspaceId: 'workspace',
      expectedRevision: 1,
      enabled: false,
      policy: { timezone: 'America/Los_Angeles', cohortPersonIds: ['member'] },
      actorId: 'staff',
    };
    assert.equal(await s.saveTaskCheckinSource(db, input, later), true);
    assert.equal(await s.saveTaskCheckinSource(db, { ...input, enabled: true }, later), false);
    assert.equal(db.raw.prepare('SELECT enabled FROM task_checkin_sources').get()?.enabled, 0);
    assert.equal(await s.claimTaskOperation(db, 'operation', later), null);
    assert.equal(
      db.raw.prepare('SELECT state FROM task_checkin_operations').get()?.state,
      'superseded',
    );
  } finally {
    db.raw.close();
  }
});

void test('erasing a person removes check-in responses, mappings, consent, and private card references', async () => {
  const { s, db } = await ready();
  try {
    await s.recordTaskInteraction(
      db,
      { ...operation, payload: { text: 'ERASE-PRIVATE-RESPONSE' } },
      now,
    );
    db.raw
      .prepare(
        `INSERT INTO task_checkin_cards(source_id,task_id,person_id,channel_id,message_id,token,task_revision,consent_revision,policy_revision,updated_at)
      VALUES('source','task','member','private-channel','private-message','private-token','v1',1,1,?)`,
      )
      .run(now.toISOString());
    await deletePersonData(db, 'member');
    for (const table of ['operations', 'mappings', 'consents', 'consent_receipts', 'cards']) {
      assert.equal(
        db.raw
          .prepare(`SELECT count(*) AS n FROM task_checkin_${table} WHERE person_id='member'`)
          .get()?.n,
        0,
        table,
      );
    }
    assert.deepEqual(db.raw.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.raw.close();
  }
});

void test('unlinking and relinking a Discord account does not restore delivery consent', async () => {
  const { s, db } = await ready();
  try {
    db.raw.prepare("DELETE FROM identities WHERE id='discord-member'").run();
    db.raw
      .prepare(
        `INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at)
      VALUES('relinked','member','discord','111111111111111111',?,'self_linked',?,?)`,
      )
      .run(later.toISOString(), later.toISOString(), later.toISOString());
    assert.equal(await s.recordTaskInteraction(db, operation, later), false);
  } finally {
    db.raw.close();
  }
});

void test('exhausted retryable operations become terminal rather than sticking in the retry queue', async () => {
  const { s, db } = await ready();
  try {
    await s.recordTaskInteraction(db, operation, now);
    db.raw.prepare("UPDATE task_checkin_operations SET attempts=4 WHERE id='operation'").run();
    const claim = await s.claimTaskOperation(db, 'operation', now);
    assert.ok(claim);
    await s.completeTaskOperation(
      db,
      { id: claim.id, token: claim.claim_token },
      { state: 'retryable' },
      now,
    );
    assert.equal(
      db.raw.prepare('SELECT state FROM task_checkin_operations').get()?.state,
      'failed',
    );
  } finally {
    db.raw.close();
  }
});

void test('new response submissions are bounded per person and source without blocking later valid updates', async () => {
  const { s, db } = await ready();
  try {
    for (let index = 0; index < 5; index++)
      assert.equal(
        await s.recordTaskInteraction(db, { ...operation, id: `response-${index}` }, now),
        true,
      );
    assert.equal(await s.recordTaskInteraction(db, { ...operation, id: 'excess' }, now), false);
    assert.equal(await s.recordTaskInteraction(db, { ...operation, id: 'later' }, later), true);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM task_checkin_operations').get()?.n, 6);
  } finally {
    db.raw.close();
  }
});

void test('consent cannot switch to a different person after the Discord actor was resolved', async () => {
  const { s, db } = await ready();
  try {
    assert.equal(
      await s.setTaskCheckinConsent(
        db,
        {
          sourceId: 'source',
          personId: 'guest',
          discordUserId: '111111111111111111',
          interactionId: '100000000000000999',
          state: 'active',
          policyRevision: 1,
        },
        now,
      ),
      false,
    );
    assert.equal(
      db.raw
        .prepare("SELECT count(*) AS n FROM task_checkin_consent_receipts WHERE id='wrong-person'")
        .get()?.n,
      0,
    );
  } finally {
    db.raw.close();
  }
});
