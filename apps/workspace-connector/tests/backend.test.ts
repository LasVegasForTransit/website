import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backend } from './support/backend';

void test('a Directory notification enrolls and confirms Console access through the real D1 API, then suspension removes it', async () => {
  const f = await backend();
  try {
    const response = await f.notify();
    assert.equal(response.status, 204);
    assert.equal(f.granted(), true);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM people').first())?.n, 1);
    assert.equal(
      (await f.db.prepare('SELECT console_state FROM workspace_enrollments').first())
        ?.console_state,
      'granted',
    );
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM consent_records').first())?.n, 0);
    assert.equal(
      (await f.db.prepare('SELECT count(*) AS n FROM committee_assignments').first())?.n,
      0,
    );
    const budget = await f.db.prepare('SELECT * FROM workspace_connector_budget').first();
    assert.equal(budget?.blocked, 0);
    assert.ok(Number(budget.charged_reads) > 0);
    await f.notify();
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM people').first())?.n, 1);
    f.suspend();
    assert.equal((await f.notify()).status, 204);
    assert.equal(f.granted(), false);
    const enrollment = await f.db
      .prepare('SELECT state,console_state FROM workspace_enrollments')
      .first();
    assert.equal(enrollment?.state, 'inactive');
    assert.equal(enrollment.console_state, 'absent');
  } finally {
    await f.close();
  }
});
