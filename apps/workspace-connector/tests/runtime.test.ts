import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, config, directory, user, notification } from './support/runtime';

void test('valid notification immediately rereads the immutable account and completes independent group readback', async () => {
  const f = await fixture();
  assert.equal((await f.connector.fetch(notification())).status, 204);
  const enrollment = f.actions.find((a) => a.action === 'enroll');
  assert.equal((enrollment?.account as { email: string }).email, user.primaryEmail);
  assert.equal((enrollment?.account as { orgUnitId: string }).orgUnitId, 'id:people');
  assert.ok(f.actions.some((a) => a.action === 'prepare'));
  assert.ok(
    f.actions.some(
      (a) => a.action === 'observed' && (a.observation as { granted: boolean }).granted,
    ),
  );
  assert.ok(f.actions.some((a) => a.action === 'finish' && !a.failure));
});
void test('bad channel proof causes no Directory work', async () => {
  const f = await fixture();
  assert.equal((await f.connector.fetch(notification('wrong'))).status, 401);
  assert.equal(f.urls.filter((u) => u.startsWith(directory)).length, 0);
});
void test('a stale plan performs no membership write', async () => {
  const f = await fixture({ stale: true });
  await f.connector.fetch(notification());
  assert.equal(
    f.actions.some((a) => a.action === 'prepare'),
    false,
  );
});
void test('Directory quota persists shared backoff and stops the run', async () => {
  const f = await fixture({ quota: true });
  assert.equal((await f.connector.fetch(notification())).status, 503);
  assert.ok(f.actions.some((a) => a.action === 'backoff' && a.retryAfterMs === 120000));
  assert.equal(
    f.actions.some((a) => a.action === 'claim'),
    false,
  );
});
void test('Scheduler identity runs channel maintenance and checkpoints the recovery scan', async () => {
  const f = await fixture({ scan: true });
  assert.equal(
    (
      await f.connector.fetch(
        new Request(`${config.origin}/run`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${f.scheduler}` },
        }),
      )
    ).status,
    200,
  );
  assert.equal(f.actions.filter((a) => a.action === 'maintenance').length, 1);
  assert.equal(f.actions.filter((a) => a.action === 'channelRegister').length, 0);
  assert.ok(
    f.actions.some((a) => a.action === 'enrollBatch' && (a.accounts as unknown[]).length === 1),
  );
  assert.ok(
    f.actions.some(
      (a) =>
        a.action === 'scanSave' &&
        a.pageToken === 'next-page' &&
        a.offset === 0 &&
        a.complete === false,
    ),
  );
});

void test('persistent Google backoff acknowledges notifications without provider calls', async () => {
  const f = await fixture({ backoff: true });
  assert.equal((await f.connector.fetch(notification())).status, 204);
  assert.equal(f.urls.filter((u) => u.startsWith(directory)).length, 0);
});
void test('duplicate notifications reuse portal enrollment and do not replay a completed group lease', async () => {
  const f = await fixture();
  await f.connector.fetch(notification());
  await f.connector.fetch(notification());
  assert.equal(f.actions.filter((a) => a.action === 'prepare').length, 1);
  assert.equal(f.actions.filter((a) => a.action === 'enroll').length, 2);
});
void test('channel renewal registers exact pinned watches and confirms provider expirations', async () => {
  const f = await fixture({ renew: true });
  assert.equal(
    (
      await f.connector.fetch(
        new Request(`${config.origin}/run`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${f.scheduler}` },
        }),
      )
    ).status,
    200,
  );
  assert.equal(f.actions.filter((a) => a.action === 'channelConfirm').length, 4);
  assert.ok(
    f.actions
      .filter((a) => a.action === 'channelRegister')
      .every((a) => typeof a.tokenHash === 'string' && a.tokenHash.length === 43),
  );
});
void test('only explicit deleted Directory records produce tombstones and complete a scan', async () => {
  const f = await fixture({ scan: true, deleted: true });
  assert.equal(
    (
      await f.connector.fetch(
        new Request(`${config.origin}/run`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${f.scheduler}` },
        }),
      )
    ).status,
    200,
  );
  assert.ok(
    f.actions.some(
      (a) =>
        a.action === 'enrollBatch' &&
        (a.accounts as { deleted: boolean }[]).some((account) => account.deleted),
    ),
  );
  assert.ok(f.actions.some((a) => a.action === 'scanSave' && a.complete === true));
});
void test('a different valid Google workload subject performs no data work', async () => {
  const f = await fixture({ wrongIdentity: true });
  assert.equal(
    (
      await f.connector.fetch(
        new Request(`${config.origin}/run`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${f.scheduler}` },
        }),
      )
    ).status,
    401,
  );
  assert.equal(f.actions.length, 0);
});

void test('expired Scheduler tokens perform no data work', async () => {
  const f = await fixture({ expired: true });
  assert.equal(
    (
      await f.connector.fetch(
        new Request(`${config.origin}/run`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${f.scheduler}` },
        }),
      )
    ).status,
    401,
  );
  assert.equal(f.actions.length, 0);
});
void test('recovery batches at most twenty accounts and resumes a saved offset', async () => {
  const f = await fixture({ scan: true, count: 25, offset: 20 });
  await f.connector.fetch(
    new Request(`${config.origin}/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${f.scheduler}` },
    }),
  );
  const batches = f.actions
    .filter((a) => a.action === 'enrollBatch')
    .map((a) => a.accounts as { userId: string }[]);
  assert.deepEqual(
    batches.map((a) => a.length),
    [5],
  );
  assert.equal(batches[0]?.[0]?.userId, 'user-21');
});
void test('full page recovery writes multiple bounded enrollment batches', async () => {
  const f = await fixture({ scan: true, count: 25 });
  await f.connector.fetch(
    new Request(`${config.origin}/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${f.scheduler}` },
    }),
  );
  assert.deepEqual(
    f.actions
      .filter((a) => a.action === 'enrollBatch')
      .map((a) => (a.accounts as unknown[]).length),
    [20, 5],
  );
});
void test('a bounded recovery saves its partial-page offset before yielding', async () => {
  const f = await fixture({ scan: true, count: 50, stopScan: true });
  assert.equal(
    (
      await f.connector.fetch(
        new Request(`${config.origin}/run`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${f.scheduler}` },
        }),
      )
    ).status,
    200,
  );
  assert.ok(
    f.actions.some(
      (a) =>
        a.action === 'scanSave' &&
        typeof a.offset === 'number' &&
        a.offset > 0 &&
        a.offset < 50 &&
        a.pageToken === null &&
        a.complete === false,
    ),
  );
});

void test('even an empty quota error persists Google backoff before stopping', async () => {
  const f = await fixture({ emptyQuota: true });
  assert.equal((await f.connector.fetch(notification())).status, 503);
  assert.ok(f.actions.some((a) => a.action === 'backoff' && a.retryAfterMs === 90000));
});

for (const deleted of [false, true]) {
  void test(`an expired ${deleted ? 'deleted' : 'active'} page cursor restarts recovery under its current lease`, async () => {
    const f = await fixture({ scan: true, deleted, expiredCursor: true });
    assert.equal(
      (
        await f.connector.fetch(
          new Request(`${config.origin}/run`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${f.scheduler}` },
          }),
        )
      ).status,
      200,
    );
    assert.ok(f.actions.some((a) => a.action === 'scanReset' && a.token === 'scan'));
    assert.equal(
      f.actions.some((a) => a.action === 'enrollBatch' || a.action === 'scanSave'),
      false,
    );
  });
}
void test('a transient Directory page failure preserves its cursor for retry', async () => {
  const f = await fixture({ scan: true, transientCursor: true });
  assert.equal(
    (
      await f.connector.fetch(
        new Request(`${config.origin}/run`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${f.scheduler}` },
        }),
      )
    ).status,
    503,
  );
  assert.equal(
    f.actions.some((a) => a.action === 'scanReset'),
    false,
  );
});

void test('the hosted group executor rejects an out-of-scope preview user before any provider read', async () => {
  const f = await fixture({ excludedGroupUser: true });
  await f.connector.fetch(
    new Request(`${config.origin}/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${f.scheduler}` },
    }),
  );
  assert.equal(
    f.urls.some((url) => url.includes('/groups/')),
    false,
  );
  assert.equal(
    f.urls.some((url) => url === 'https://oauth2.googleapis.com/token'),
    false,
  );
});
