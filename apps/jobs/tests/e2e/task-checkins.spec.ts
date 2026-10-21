import assert from 'node:assert/strict';
import { taskRuntime } from './support/task-checkins';

const fixture = await taskRuntime();
const {
  db,
  accounts,
  sourceId,
  guildId,
  signed,
  steps,
  sends,
  comments,
  completions,
  providerCalls,
} = fixture;
let interactionId = 777777777777777770n;
try {
  const scan = await steps.scan.run();
  assert.equal(scan.kind, 'scanned', JSON.stringify({ scan, providerCalls }));
  assert.equal((await steps.queue.run()).queued, 0, 'staff mapping cannot opt in either person');
  for (const account of accounts) {
    const setup = await signed({
      type: 2,
      guild_id: guildId,
      member: { user: { id: account.user } },
      data: { name: 'checkins' },
    });
    assert.equal(setup.status, 200);
    assert.equal(((await setup.json()) as { data: { flags: number } }).data.flags & 64, 64);
    const consent = await signed({
      type: 3,
      guild_id: guildId,
      member: { user: { id: account.user } },
      data: { custom_id: `tcs:${sourceId}:1:active` },
    });
    assert.equal(consent.status, 200);
  }
  assert.equal((await steps.queue.run()).queued, 2);
  await steps.operation.run();
  await steps.operation.run();
  assert.equal(sends.length, 2);
  for (const account of accounts) {
    const sent = sends.find((item) => item.recipient === account.user);
    assert.ok(sent);
    assert.match(JSON.stringify(sent.body), new RegExp(`Private ${account.person} task`));
    assert.ok(
      !JSON.stringify(sent.body).includes(
        `Private ${account.person === 'member' ? 'guest' : 'member'} task`,
      ),
    );
    const card = await db
      .prepare('SELECT token FROM task_checkin_cards WHERE person_id=?')
      .bind(account.person)
      .first<{ token: string }>();
    assert.ok(card);
    const submission = {
      id: String(++interactionId),
      type: 5,
      user: { id: account.user },
      channel_id: account.channel,
      data: {
        custom_id: `tc:${card.token}:progress`,
        components: [
          {
            type: 18,
            component: { type: 4, custom_id: 'note', value: `Update from ${account.person}` },
          },
        ],
      },
    };
    const response = await signed(submission);
    assert.equal(response.status, 200);
    assert.match(JSON.stringify(await response.json()), /waiting to be saved/);
    assert.equal((await signed(submission)).status, 200);
    assert.equal(
      comments.length,
      accounts.indexOf(account),
      'callback acknowledges durable intent before provider write',
    );
    await steps.operation.run();
    assert.equal(comments.length, accounts.indexOf(account) + 1);
    assert.equal((comments.at(-1)?.parent as { page_id: string }).page_id, account.task);
    const completeButton = {
      type: 3,
      user: { id: account.user },
      channel_id: account.channel,
      message: { id: account.message },
      data: { custom_id: `tc:${card.token}:complete` },
    };
    const confirmation = await signed(completeButton);
    assert.equal(confirmation.status, 200);
    assert.match(JSON.stringify(await confirmation.json()), /confirm/i);
    assert.equal(completions.length, accounts.indexOf(account));
    const other = accounts.find((candidate) => candidate.person !== account.person);
    assert.ok(other);
    const wrongActor = await signed({ ...completeButton, user: { id: other.user } });
    assert.equal(wrongActor.status, 403);
    const completed = await signed({
      type: 3,
      user: { id: account.user },
      channel_id: account.channel,
      message: { id: String(BigInt(account.message) + 10n), flags: 64 },
      data: { custom_id: `tc:${card.token}:confirm` },
    });
    assert.equal(completed.status, 200);
    await steps.operation.run();
    assert.ok(completions.includes(account.task));
  }
  assert.equal(
    (await db.prepare("SELECT membership_status FROM people WHERE id='guest'").first())
      ?.membership_status,
    'not_member',
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT count(*) AS n FROM task_checkin_operations WHERE kind<>'delivery' AND state='confirmed'",
        )
        .first()
    )?.n,
    4,
  );
  assert.equal((await steps.queue.run()).queued, 0);
  assert.equal(sends.length, 2);
  console.log(
    'Compiled site callback + jobs entrypoints: member and guest private flows passed. Provider APIs were simulated.',
  );
} finally {
  await fixture.dispose();
}
