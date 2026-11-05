import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backend } from './support/backend';
import { fixture, config } from './support/runtime';
import { tokenHash } from '../src/maintenance';

for (const production of [false, true]) {
  void test(`an idle minute heartbeat fits ${production ? 'production' : 'preview'} Google capacity with useful-work headroom`, async (t) => {
    const f = await backend({ production });
    try {
      const expiresAt = '2026-11-04T21:00:00.000Z';
      for (const event of ['update', 'delete', 'undelete']) {
        await f.action('channelRegister', {
          id: `${event}.budget`,
          event,
          tokenHash: tokenHash(event),
          expiresAt,
        });
        await f.action('channelConfirm', {
          id: `${event}.budget`,
          resourceId: `resource-${event}`,
          expiresAt,
        });
      }
      await f.db
        .prepare(
          "INSERT INTO workspace_directory_scans(customer_id,next_due_at) VALUES('C-lvbt',?)",
        )
        .bind(expiresAt)
        .run();
      const before = await f.db
        .prepare('SELECT charged_writes FROM workspace_connector_budget')
        .first();
      const requestCount = f.calls.filter((url) => url === config.siteAudience).length;
      assert.equal((await f.run()).status, 200);
      const after = await f.db
        .prepare('SELECT charged_writes,blocked FROM workspace_connector_budget')
        .first();
      const perMinute = Number(after?.charged_writes) - Number(before?.charged_writes);
      assert.ok(perMinute > 0);
      const ceiling = production ? 20000 : 10000;
      t.diagnostic(`Measured idle charge: ${perMinute} writes/minute, ${perMinute * 1440}/day`);
      assert.ok(
        perMinute * 1440 <= ceiling,
        `idle daily charge ${perMinute * 1440} leaves insufficient Google write headroom`,
      );
      assert.equal(after?.blocked, 0);
      assert.equal(f.calls.filter((url) => url === config.siteAudience).length - requestCount, 1);
    } finally {
      await f.close();
    }
  });
}
void test('an idle heartbeat performs one maintenance action without claiming a group lease', async () => {
  const f = await fixture({ idleGroups: true });
  await f.connector.fetch(
    new Request(`${config.origin}/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${f.scheduler}` },
    }),
  );
  assert.deepEqual(
    f.actions.map((a) => a.action),
    ['maintenance'],
  );
});
