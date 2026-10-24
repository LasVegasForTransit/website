import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { loadActor } from '@lasvegasfortransit/platform-storage/staff-roles';
import { issueFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import type { StaffContext } from '../src/lib/context';
const sourceId = '10000000-0000-4000-8000-000000000001';
async function fixture() {
  const db = memoryDb(),
    stamp = new Date().toISOString();
  for (const id of ['staff', 'backup', 'guest'])
    db.raw
      .prepare(
        "INSERT INTO people(id,membership_status,created_at,updated_at) VALUES(?,'member',?,?)",
      )
      .run(id, stamp, stamp);
  for (const id of ['staff', 'backup'])
    db.raw
      .prepare(
        "INSERT INTO staff_administrators(person_id,designated_by,designated_at) VALUES(?,'staff',?)",
      )
      .run(id, stamp);
  const actor = await loadActor(db, 'staff');
  assert.ok(actor);
  const staff: StaffContext = { db, actor, requestId: 'fixture' };
  const api = await import('../src/lib/task-checkins').catch(() => null);
  assert.ok(api, 'staff task forms must exist');
  const submitForm = api.submitTaskCheckinForm;
  async function submit(
    fields: Record<string, string>,
    origin = 'https://staff.lasvegasfortransit.org',
  ) {
    const action = fields.action;
    const token = await issueFormToken(db, staff.actor, `task-checkins:${sourceId}:${action}`);
    const request = new Request(
      `https://staff.lasvegasfortransit.org/task-checkins/settings/?source=${sourceId}`,
      {
        method: 'POST',
        headers: { Origin: origin },
        body: new URLSearchParams({ token, ...fields }),
      },
    );
    return submitForm(request, staff, sourceId);
  }
  return { db, staff, api, submit };
}
void test('mapping correction and removal require current form scope and exact saved match', async () => {
  const f = await fixture();
  try {
    await f.db
      .prepare(
        `INSERT INTO task_checkin_sources(id,workspace_id,revision,enabled,policy_json,updated_at)
      VALUES(?,'workspace',1,0,'{}',?)`,
      )
      .bind(sourceId, new Date().toISOString())
      .run();
    assert.equal(
      (
        await f.submit({
          action: 'mapping',
          notionUserId: 'notion-guest',
          personId: 'guest',
          expectedRevision: '1',
        })
      ).status,
      303,
    );
    const before = f.db.raw.prepare('SELECT version FROM task_checkin_mappings').get();
    assert.ok(before);
    const input = {
      action: 'mapping_change',
      notionUserId: 'notion-guest',
      personId: 'backup',
      expectedRevision: '1',
      expectedPersonId: 'guest',
      expectedVersion: String(before.version),
    };
    assert.equal((await f.submit(input, 'https://outside.invalid')).status, 403);
    assert.equal((await f.submit(input)).status, 303);
    assert.equal((await f.submit(input)).status, 409);
    const after = f.db.raw.prepare('SELECT version FROM task_checkin_mappings').get();
    assert.ok(after);
    assert.equal(
      (
        await f.submit({
          ...input,
          action: 'mapping_remove',
          expectedVersion: String(after.version),
          expectedPersonId: 'backup',
        })
      ).status,
      303,
    );
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM task_checkin_mappings').get()?.n, 0);
  } finally {
    f.db.raw.close();
  }
});
void test('staff forms reject cross-origin, missing tokens and revoked administrators', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.submit({ action: 'configure' }, 'https://example.invalid')).status, 403);
    assert.equal((await f.submit({ action: 'configure', token: 'bad' })).status, 409);
    f.db.raw.prepare("DELETE FROM staff_administrators WHERE person_id='staff'").run();
    assert.equal((await f.submit({ action: 'configure' })).status, 403);
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM task_checkin_sources').get()?.n, 0);
  } finally {
    f.db.raw.close();
  }
});
void test('incomplete settings are legible and cannot enable delivery', async () => {
  const f = await fixture();
  try {
    const result = await f.submit({
      action: 'configure',
      workspaceId: 'workspace',
      expectedRevision: '0',
      enabled: 'on',
    });
    assert.equal(result.status, 422);
    assert.ok(!(result instanceof Response));
    assert.ok(result.gaps?.includes('source'));
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM task_checkin_sources').get()?.n, 0);
    const paused = await f.submit({
      action: 'configure',
      workspaceId: 'workspace',
      expectedRevision: '0',
      timezone: 'America/Los_Angeles',
    });
    assert.equal(paused.status, 303);
    assert.equal(f.db.raw.prepare('SELECT enabled FROM task_checkin_sources').get()?.enabled, 0);
  } finally {
    f.db.raw.close();
  }
});
void test('mapping form uses the chosen person and never enables delivery consent', async () => {
  const f = await fixture();
  try {
    await f.submit({ action: 'configure', workspaceId: 'workspace', expectedRevision: '0' });
    const result = await f.submit({
      action: 'mapping',
      expectedRevision: '1',
      notionUserId: 'notion-guest',
      personId: 'guest',
    });
    assert.equal(result.status, 303);
    assert.equal(
      f.db.raw.prepare('SELECT person_id FROM task_checkin_mappings').get()?.person_id,
      'guest',
    );
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM task_checkin_consents').get()?.n, 0);
  } finally {
    f.db.raw.close();
  }
});

void test('staff can queue a read-only Notion check or close a held update without retrying the effect', async () => {
  const f = await fixture();
  try {
    await f.submit({ action: 'configure', workspaceId: 'workspace', expectedRevision: '0' });
    const stamp = new Date().toISOString();
    f.db.raw
      .prepare(
        "INSERT INTO task_checkin_tasks(source_id,task_id,revision,source_edited_at,active,snapshot_json,updated_at) VALUES(?,'task','v1',?,1,'{}',?)",
      )
      .run(sourceId, stamp, stamp);
    f.db.raw
      .prepare(
        "INSERT INTO task_checkin_operations(id,source_id,task_id,person_id,task_revision,consent_revision,policy_revision,kind,payload_json,state,reason,next_attempt_at,created_at,updated_at) VALUES('held',?,'task','guest','v1',1,1,'progress','{}','held','unconfirmed_effect',?,?,?)",
      )
      .run(sourceId, stamp, stamp, stamp);
    const input = { operationId: 'held', expectedUpdatedAt: stamp };
    assert.equal((await f.submit({ ...input, action: 'reconcile' })).status, 303);
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_recovery').get()?.state,
      'queued',
    );
    assert.equal((await f.submit({ ...input, action: 'retry' })).status, 409);
    assert.equal((await f.submit({ ...input, action: 'close' })).status, 303);
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_operations').get()?.state,
      'superseded',
    );
    assert.equal(
      f.db.raw.prepare('SELECT result_json FROM task_checkin_operations').get()?.result_json,
      null,
    );
  } finally {
    f.db.raw.close();
  }
});
