import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, sourceId, guildId, userId } from './support/task-checkin-interaction-fixture';
const command = {
  type: 2,
  id: '666666666666666670',
  guild_id: guildId,
  member: { user: { id: userId } },
  data: { name: 'checkins' },
};
const choice = (state: string, id: string) => ({
  type: 3,
  id,
  guild_id: guildId,
  member: { user: { id: userId } },
  data: { custom_id: `tcs:${sourceId}:1:${state}` },
});
void test('a globally disabled service still offers private pause and stop without enabling consent or exposing tasks', async () => {
  const f = await fixture();
  try {
    await f.consent();
    f.env.LVBT_TASK_CHECKINS_ENABLED = 'false';
    const setup = await f.send(command);
    assert.equal(setup.status, 200);
    const reply = await setup.json<{ data: { flags: number } }>(),
      serialized = JSON.stringify(reply);
    assert.equal(reply.data.flags & 64, 64);
    assert.match(serialized, /Pause check-ins/);
    assert.match(serialized, /Stop check-ins/);
    assert.equal(serialized.includes(':active'), false);
    assert.equal(serialized.includes('Prepare agenda'), false);
    assert.equal(serialized.includes('21:00'), false);
    await f.send(choice('paused', '666666666666666671'));
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_consents').get()?.state,
      'paused',
    );
    await f.send(choice('active', '666666666666666672'));
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_consents').get()?.state,
      'paused',
    );
    assert.equal(
      f.db.raw.prepare('SELECT count(*) AS n FROM task_checkin_consent_receipts').get()?.n,
      2,
    );
    f.db.raw.prepare("UPDATE task_checkin_sources SET policy_json='{}',revision=revision+1").run();
    assert.equal((await f.send(choice('opted_out', '666666666666666673'))).status, 200);
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_consents').get()?.state,
      'opted_out',
    );
    assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM task_checkin_operations').get()?.n, 0);
  } finally {
    f.db.raw.close();
  }
});
void test('an incomplete policy still lets a linked person reach stop controls', async () => {
  const f = await fixture();
  try {
    await f.consent();
    f.db.raw.prepare("UPDATE task_checkin_sources SET policy_json='{}',revision=revision+1").run();
    const setup = await f.send(command);
    assert.equal(setup.status, 200);
    assert.match(JSON.stringify(await setup.json()), /Stop check-ins/);
    await f.send(choice('opted_out', '666666666666666674'));
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_consents').get()?.state,
      'opted_out',
    );
  } finally {
    f.db.raw.close();
  }
});
void test("leaving the approved cohort does not remove a linked volunteer's stop controls", async () => {
  const f = await fixture();
  try {
    await f.consent();
    f.db.raw
      .prepare(
        "UPDATE task_checkin_sources SET policy_json=json_set(policy_json,'$.cohortPersonIds',json('[\"staff\"]')),revision=revision+1",
      )
      .run();
    const setup = await f.send(command),
      reply = JSON.stringify(await setup.json());
    assert.match(reply, /Stop check-ins/);
    assert.equal(reply.includes(':active'), false);
    await f.send(choice('opted_out', '666666666666666676'));
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_consents').get()?.state,
      'opted_out',
    );
  } finally {
    f.db.raw.close();
  }
});
void test('disabled preference controls retain signature, application, guild and source isolation', async () => {
  const f = await fixture();
  try {
    await f.consent();
    f.env.LVBT_TASK_CHECKINS_ENABLED = 'false';
    for (const override of [
      { application_id: '999999999999999998' },
      { guild_id: '999999999999999999' },
      { member: { user: { id: '888888888888888888' } } },
      { data: { custom_id: `tcs:${f.env.LVBT_NOTION_TASK_PRODUCTION_SOURCE_ID}:1:opted_out` } },
    ])
      assert.equal(
        (await f.send({ ...choice('opted_out', '666666666666666675'), ...override })).status,
        403,
      );
    assert.equal((await f.send(command, '1')).status, 401);
    f.env.LVBT_NOTION_TASK_SOURCE_ID = f.env.LVBT_NOTION_TASK_PRODUCTION_SOURCE_ID;
    assert.equal((await f.send(command)).status, 404);
    assert.equal(
      f.db.raw.prepare('SELECT state FROM task_checkin_consents').get()?.state,
      'active',
    );
    assert.equal(
      f.db.raw.prepare('SELECT count(*) AS n FROM task_checkin_consent_receipts').get()?.n,
      1,
    );
  } finally {
    f.db.raw.close();
  }
});
