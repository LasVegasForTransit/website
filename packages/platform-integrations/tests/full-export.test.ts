import assert from 'node:assert/strict';
import test from 'node:test';
import { strFromU8, unzipSync } from 'fflate/browser';
import { readCsv } from './support/export-csv';
import { mergeFixture } from '../../platform-storage/tests/support/merge-fixture';
async function exportFixture() {
  const loaded = await import('../src/export-archive').catch(() => null);
  assert.ok(loaded, 'an administrator must be able to download the complete member archive');
  return { ...loaded, ...(await mergeFixture()) };
}
void test('a full export contains the specified files, consent evidence and equivalent data without deleted people or credentials', async () => {
  const f = await exportFixture();
  await f.people.updateFields(f.survivor.id, {
    source: 'staff',
    fields: { given_name: '=SUM(1,2)', family_name: 'Rider,"quoted"\nNext line' },
  });
  await f.people.linkIdentity(f.survivor.id, {
    platform: 'discord',
    externalId: '111111111111111111',
    linkMethod: 'self_linked',
  });
  await f.people.recordEngagement(f.survivor.id, {
    type: 'attended',
    source: 'paper',
    occurredAt: '2026-10-01T12:00:00.000Z',
    details: { eventName: 'CityNerd, meetup' },
  });
  await f.people.deletePerson(f.merged.id);
  const response = await f.exportPeople(f.db, f.actor, {
    now: new Date('2026-10-05T02:00:00.000Z'),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/zip');
  assert.match(response.headers.get('Content-Disposition') ?? '', /2026-10-04\.zip/);
  assert.match(response.headers.get('Cache-Control') ?? '', /no-store/);
  const zip = unzipSync(new Uint8Array(await response.arrayBuffer()));
  assert.deepEqual(Object.keys(zip).sort(), [
    'README.txt',
    'consent_records.csv',
    'engagement_events.csv',
    'export.json',
    'identities.csv',
    'people.csv',
  ]);
  const contents = Object.fromEntries(
    Object.entries(zip).map(([key, value]) => [key, strFromU8(value)]),
  );
  const data = JSON.parse(contents['export.json'] ?? '') as Record<string, unknown>;
  const rows = data.people as Record<string, unknown>[];
  assert.equal(rows.length, 2);
  assert.ok(rows.every((p) => p.id !== f.merged.id));
  assert.equal(rows.find((p) => p.id === f.survivor.id)?.given_name, '=SUM(1,2)');
  assert.ok(contents['people.csv']?.includes("'="));
  assert.ok(contents['people.csv']?.includes('Rider,""quoted""\nNext line'));
  assert.ok(contents['consent_records.csv']?.includes('fixture'));
  assert.ok(contents['identities.csv']?.includes('111111111111111111'));
  assert.ok(contents['engagement_events.csv']?.includes('CityNerd, meetup'));
  for (const table of ['people', 'consent_records', 'identities', 'engagement_events']) {
    const [headers, ...records] = readCsv(contents[table + '.csv'] ?? '');
    assert.ok(headers);
    const originals = data[table] as Record<string, string | number | null>[];
    assert.equal(records.length, originals.length);
    records.forEach((record, index) =>
      headers.forEach((header, column) => {
        const original = originals[index]?.[header];
        const expected = original === null ? '' : String(original);
        assert.ok(
          record[column] === expected || record[column] === "'" + expected,
          table + '.' + header,
        );
      }),
    );
  }
  assert.equal(Object.values(contents).join('\n').includes(f.merged.id), false);
  for (const forbidden of ['token_hash', 'code_hash', 'oauth_states', 'sign_in_secret'])
    assert.equal(Object.values(contents).join('\n').includes(forbidden), false);
  const audit = f.db.raw
    .prepare("SELECT actor_id,details FROM staff_audits WHERE action='people.export'")
    .get();
  assert.equal(audit?.actor_id, f.actor.personId);
  assert.deepEqual(JSON.parse(String(audit.details)), { people: 2, formatVersion: 1 });
  f.db.raw.close();
});
void test('a stale administrator and a forged lead actor cannot export any member data', async () => {
  const f = await exportFixture();
  const forged = { ...f.actor, personId: f.survivor.id };
  const denied = await f.exportPeople(f.db, forged);
  assert.equal(denied.status, 403);
  assert.equal((await denied.text()).includes('survivor@example.invalid'), false);
  await f.people.withdrawConsent(f.admin.id, {
    scope: 'newsletter',
    source: 'account',
    withdrawnAt: new Date().toISOString(),
  });
  assert.equal((await f.exportPeople(f.db, f.actor)).status, 403);
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM staff_audits WHERE action='people.export'").get()
      ?.n,
    0,
  );
  f.db.raw.close();
});
void test('an audit write failure cannot release an archive', async () => {
  const f = await exportFixture();
  f.db.raw.exec(
    "CREATE TRIGGER reject_export BEFORE INSERT ON staff_audits WHEN NEW.action='people.export' BEGIN SELECT RAISE(ABORT,'fixture export fault'); END",
  );
  await assert.rejects(f.exportPeople(f.db, f.actor), /fixture export fault/);
  f.db.raw.close();
});
void test('revoking administrator membership before the export transaction cannot release a partial snapshot', async () => {
  const f = await exportFixture();
  const db = {
    prepare: (sql: string) => f.db.prepare(sql),
    batch: async (statements: Parameters<typeof f.db.batch>[0]) => {
      await f.people.withdrawConsent(f.admin.id, {
        scope: 'newsletter',
        source: 'account',
        withdrawnAt: new Date().toISOString(),
      });
      return await f.db.batch(statements);
    },
  };
  const response = await f.exportPeople(db, f.actor);
  assert.equal(response.status, 403);
  assert.equal((await response.text()).includes('survivor@example.invalid'), false);
  assert.equal(
    f.db.raw.prepare("SELECT count(*) AS n FROM staff_audits WHERE action='people.export'").get()
      ?.n,
    0,
  );
  f.db.raw.close();
});
void test('the member archive includes stored Discord profile observations without exporting OAuth state', async () => {
  const f = await exportFixture();
  await f.people.linkIdentity(f.survivor.id, {
    platform: 'discord',
    externalId: '111111111111111111',
    linkMethod: 'self_linked',
  });
  const identity = await f.db
    .prepare("SELECT id FROM identities WHERE person_id=? AND platform='discord'")
    .bind(f.survivor.id)
    .first<{ id: string }>();
  assert.ok(identity);
  const stamp = new Date().toISOString();
  await f.db
    .prepare(
      'INSERT INTO discord_identity_profiles(identity_record_id,username,display_name,verified_at) VALUES(?,?,?,?)',
    )
    .bind(identity.id, 'rider', 'Transit rider', stamp)
    .run();
  await f.db
    .prepare(
      'INSERT INTO discord_profiles(identity_record_id,guild_id,username,nickname,in_guild,pending,observed_at,expires_at) VALUES(?,?,?,?,1,0,?,?)',
    )
    .bind(identity.id, '222222222222222222', 'rider', 'Bus rider', stamp, stamp)
    .run();
  const response = await f.exportPeople(f.db, f.actor);
  const zip = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const data = JSON.parse(strFromU8(zip['export.json'] ?? new Uint8Array())) as {
    discord_identity_profiles?: { username: string }[];
    discord_profiles?: { nickname: string }[];
  };
  assert.equal(data.discord_identity_profiles?.[0]?.username, 'rider');
  assert.equal(data.discord_profiles?.[0]?.nickname, 'Bus rider');
  f.db.raw.close();
});
