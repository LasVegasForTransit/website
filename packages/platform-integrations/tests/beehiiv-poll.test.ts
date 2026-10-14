import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb, everyStoredText } from '@lasvegasfortransit/platform-storage/test-db';

function address(input: Parameters<typeof fetch>[0]): string {
  return input instanceof Request ? input.url : input instanceof URL ? input.href : input;
}

const config = { apiKey: 'private-poll-key', publicationId: 'pub_poll_fixture' };
const start = new Date('2026-10-14T14:00:00.000Z');
const row = (id: string, status = 'active') => ({
  id,
  email: `${id}@example.invalid`,
  status,
  created: 1700000000,
});

async function poller() {
  const module = await import('../src/beehiiv-poll').catch(() => null);
  assert.ok(module, 'Beehiiv polling needs a durable checkpoint and source observations');
  return module.pollBeehiivRoster;
}

void test('poll requests cannot follow a redirect with publication credentials', async () => {
  const db = memoryDb();
  try {
    const poll = await poller();
    let redirect: RequestInit['redirect'];
    const result = await poll(db, config, {
      now: () => start,
      fetcher: (_input, init) => {
        redirect = init?.redirect;
        return Promise.resolve(
          new Response(null, { status: 302, headers: { Location: 'https://example.invalid/' } }),
        );
      },
    });
    assert.equal(result.kind, 'retry');
    assert.equal(redirect, 'manual');
    assert.equal(
      db.raw.prepare('SELECT pages_read FROM beehiiv_poll_checkpoints').get()?.pages_read,
      0,
    );
  } finally {
    db.raw.close();
  }
});

void test('an atomic save failure preserves the previous page and retries the same cursor', async () => {
  const db = memoryDb();
  try {
    const poll = await poller();
    await poll(db, config, {
      now: () => start,
      fetcher: () =>
        Promise.resolve(
          Response.json({ data: [row('sub_kept')], has_more: true, next_cursor: 'second' }),
        ),
    });
    db.raw.exec(
      "CREATE TRIGGER fail_poll BEFORE INSERT ON beehiiv_subscription_observations WHEN NEW.subscription_id='sub_fail' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;",
    );
    const fetcher: typeof fetch = () =>
      Promise.resolve(
        Response.json({
          data: [row('sub_next'), row('sub_fail')],
          has_more: false,
          next_cursor: null,
        }),
      );
    await assert.rejects(() => poll(db, config, { now: () => start, fetcher }), /fixture failure/);
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM beehiiv_subscription_observations').get()?.n,
      1,
    );
    assert.equal(
      db.raw.prepare('SELECT cursor FROM beehiiv_poll_checkpoints').get()?.cursor,
      'second',
    );
    assert.equal(
      db.raw.prepare('SELECT pages_read FROM beehiiv_poll_checkpoints').get()?.pages_read,
      1,
    );
    db.raw.exec('DROP TRIGGER fail_poll');
    assert.equal((await poll(db, config, { now: () => start, fetcher })).complete, true);
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM beehiiv_subscription_observations').get()?.n,
      3,
    );
  } finally {
    db.raw.close();
  }
});

void test('five thousand subscriptions converge across bounded persistent pages', async () => {
  const db = memoryDb();
  try {
    const poll = await poller();
    let requests = 0;
    const fetcher: typeof fetch = (input) => {
      const url = new URL(address(input));
      const first = Number(url.searchParams.get('cursor') ?? 0);
      requests++;
      return Promise.resolve(
        Response.json({
          data: Array.from({ length: 100 }, (_, i) => row(`sub_capacity_${first + i}`)),
          has_more: first + 100 < 5000,
          next_cursor: first + 100 < 5000 ? String(first + 100) : null,
        }),
      );
    };
    for (let i = 0; i < 50; i++) {
      const result = await poll(db, config, {
        now: () => new Date(start.getTime() + i * 1000),
        fetcher,
      });
      assert.equal(result.records, 100);
      assert.equal(result.complete, i === 49);
    }
    assert.equal(requests, 50);
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM beehiiv_subscription_observations').get()?.n,
      5000,
    );
    const saved = db.raw
      .prepare('SELECT pages_read,accounts_read FROM beehiiv_poll_checkpoints')
      .get();
    assert.ok(saved);
    assert.equal(saved.pages_read, 50);
    assert.equal(saved.accounts_read, 5000);
  } finally {
    db.raw.close();
  }
});

void test('saving or deferring one publication leaves another publication checkpoint unchanged', async () => {
  const db = memoryDb();
  try {
    const poll = await poller();
    const first = { ...config, publicationId: 'pub_first' };
    const second = { ...config, publicationId: 'pub_second' };
    await poll(db, first, {
      now: () => start,
      fetcher: () =>
        Promise.resolve(Response.json({ data: [], has_more: true, next_cursor: 'first-next' })),
    });
    const before = db.raw
      .prepare("SELECT * FROM beehiiv_poll_checkpoints WHERE publication_id='pub_first'")
      .get();
    await poll(db, second, {
      now: () => start,
      fetcher: () =>
        Promise.resolve(Response.json({ data: [], has_more: false, next_cursor: null })),
    });
    assert.deepEqual(
      db.raw
        .prepare("SELECT * FROM beehiiv_poll_checkpoints WHERE publication_id='pub_first'")
        .get(),
      before,
    );
    await poll(db, second, {
      now: () => new Date(start.getTime() + 3_600_001),
      fetcher: () => Promise.resolve(new Response(null, { status: 429 })),
    });
    assert.deepEqual(
      db.raw
        .prepare("SELECT * FROM beehiiv_poll_checkpoints WHERE publication_id='pub_first'")
        .get(),
      before,
    );
  } finally {
    db.raw.close();
  }
});

void test('resumes a publication cursor across invocations without inventing member consent', async () => {
  const db = memoryDb();
  try {
    const poll = await poller();
    const cursors: (string | null)[] = [];
    const fetcher: typeof fetch = (input) => {
      const url = new URL(address(input));
      const cursor = url.searchParams.get('cursor');
      cursors.push(cursor);
      return Promise.resolve(
        Response.json({
          data: [row(cursor ? 'sub_second' : 'sub_first')],
          has_more: !cursor,
          next_cursor: cursor ? null : 'opaque/page?2',
        }),
      );
    };
    assert.deepEqual(await poll(db, config, { now: () => start, fetcher }), {
      kind: 'scanned',
      records: 1,
      complete: false,
    });
    assert.deepEqual(
      await poll(db, config, { now: () => new Date(start.getTime() + 1000), fetcher }),
      { kind: 'scanned', records: 1, complete: true },
    );
    assert.deepEqual(cursors, [null, 'opaque/page?2']);
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM beehiiv_subscription_observations').get()?.n,
      2,
    );
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 0);
    assert.doesNotMatch(everyStoredText(db), /@example.invalid|private-poll-key/);
    assert.deepEqual(
      await poll(db, config, { now: () => new Date(start.getTime() + 2000), fetcher }),
      { kind: 'idle', records: 0, complete: false },
    );
    assert.equal(cursors.length, 2);
  } finally {
    db.raw.close();
  }
});

void test('a rate limit survives a new dispatcher and keeps the failed page cursor', async () => {
  const db = memoryDb();
  try {
    const poll = await poller();
    await poll(db, config, {
      now: () => start,
      fetcher: () =>
        Promise.resolve(
          Response.json({ data: [row('sub_first')], has_more: true, next_cursor: 'page-two' }),
        ),
    });
    let calls = 0;
    const limited: typeof fetch = () => {
      calls++;
      return Promise.resolve(
        new Response('private failure', { status: 429, headers: { 'Retry-After': '1.25' } }),
      );
    };
    assert.deepEqual(await poll(db, config, { now: () => start, fetcher: limited }), {
      kind: 'retry',
      records: 0,
      complete: false,
    });
    assert.deepEqual(
      await poll(db, config, { now: () => new Date(start.getTime() + 100), fetcher: limited }),
      { kind: 'idle', records: 0, complete: false },
    );
    assert.equal(calls, 1);
    assert.equal(
      db.raw.prepare('SELECT cursor FROM beehiiv_poll_checkpoints').get()?.cursor,
      'page-two',
    );
    await poll(db, config, {
      now: () => new Date(start.getTime() + 1251),
      fetcher: () =>
        Promise.resolve(
          Response.json({ data: [row('sub_second')], has_more: false, next_cursor: null }),
        ),
    });
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM beehiiv_subscription_observations').get()?.n,
      2,
    );
    assert.doesNotMatch(everyStoredText(db), /private failure/);
  } finally {
    db.raw.close();
  }
});

void test('a late response cannot overwrite a newer scan after lease takeover', async () => {
  const db = memoryDb();
  try {
    const poll = await poller();
    let finish: ((response: Response) => void) | undefined;
    let entered: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const delayed = poll(db, config, {
      now: () => start,
      fetcher: () => {
        entered?.();
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      },
    });
    await ready;
    const newer = await poll(db, config, {
      now: () => new Date(start.getTime() + 31_000),
      fetcher: () =>
        Promise.resolve(
          Response.json({
            data: [row('sub_same', 'inactive')],
            has_more: false,
            next_cursor: null,
          }),
        ),
    });
    assert.equal(newer.kind, 'scanned');
    assert.ok(finish);
    finish(Response.json({ data: [row('sub_same')], has_more: false, next_cursor: null }));
    assert.equal((await delayed).kind, 'stale');
    assert.equal(
      db.raw.prepare('SELECT status FROM beehiiv_subscription_observations').get()?.status,
      'inactive',
    );
  } finally {
    db.raw.close();
  }
});

void test('cursor cycles and unknown delivery states do not advance or partially save a page', async () => {
  const db = memoryDb();
  try {
    const poll = await poller();
    for (const [, next] of [
      [null, 'a'],
      ['a', 'b'],
    ] as const) {
      await poll(db, config, {
        now: () => start,
        fetcher: () =>
          Promise.resolve(Response.json({ data: [], has_more: true, next_cursor: next })),
      });
      assert.equal(
        db.raw.prepare('SELECT cursor FROM beehiiv_poll_checkpoints').get()?.cursor,
        next,
      );
    }
    assert.equal(
      (
        await poll(db, config, {
          now: () => start,
          fetcher: () =>
            Promise.resolve(
              Response.json({ data: [row('sub_wrong')], has_more: true, next_cursor: 'a' }),
            ),
        })
      ).kind,
      'retry',
    );
    assert.equal(db.raw.prepare('SELECT cursor FROM beehiiv_poll_checkpoints').get()?.cursor, 'b');
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM beehiiv_subscription_observations').get()?.n,
      0,
    );
    const later = new Date(start.getTime() + 60_001);
    assert.equal(
      (
        await poll(db, config, {
          now: () => later,
          fetcher: () =>
            Promise.resolve(
              Response.json({
                data: [row('sub_good'), row('sub_unknown', 'made_up')],
                has_more: false,
                next_cursor: null,
              }),
            ),
        })
      ).kind,
      'retry',
    );
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM beehiiv_subscription_observations').get()?.n,
      0,
    );
  } finally {
    db.raw.close();
  }
});
