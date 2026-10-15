import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { unstable_splitSqlQuery } from 'wrangler';
import { memoryDb, migrationFiles } from '@lasvegasfortransit/platform-storage/test-db';

const folder = new URL('../../../packages/platform-storage/migrations/', import.meta.url);
const migrations = migrationFiles();
const pending = migrations.filter((name) => name >= '0034');
const sqlTokens =
  /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[()]|\b[A-Za-z_][A-Za-z_0-9]*\b/g;

// D1's remote /query parser treats a bare CASE END as a trigger boundary.
// The installed Wrangler splitter and ordinary SQLite both accept that SQL.
function bareTriggerCases(sql: string): string[] {
  const offending: string[] = [];
  for (const statement of unstable_splitSqlQuery(sql)) {
    const tokens = [...statement.matchAll(sqlTokens)]
      .map((match) => match[0])
      .filter((token) => !/^(--|\/\*|'|"|`|\[)/.test(token))
      .map((token) => token.toUpperCase());
    if (tokens[0] !== 'CREATE' || tokens[1] !== 'TRIGGER') continue;
    let depth = 0;
    for (const token of tokens) {
      if (token === '(') depth++;
      else if (token === ')') depth--;
      else if (token === 'CASE' && depth === 0) offending.push(tokens[2] ?? 'trigger');
    }
  }
  return offending;
}

void test('the compatibility guard distinguishes the remote bare-CASE failure from protected expressions', () => {
  const trigger = (expression: string) =>
    `CREATE TRIGGER example AFTER INSERT ON demo BEGIN SELECT ${expression}; END;`;
  assert.deepEqual(bareTriggerCases(trigger('CASE WHEN 1 THEN 1 ELSE 0 END')), ['EXAMPLE']);
  assert.deepEqual(bareTriggerCases(trigger('(CASE WHEN 1 THEN 1 ELSE 0 END)')), []);
  assert.deepEqual(bareTriggerCases(trigger("'CASE END' /* CASE END */")), []);
  assert.deepEqual(bareTriggerCases('SELECT CASE WHEN 1 THEN 1 ELSE 0 END;'), []);
});

for (const name of pending)
  void test(`${name} avoids unparenthesized trigger CASE expressions in the remote migration command`, () => {
    const sql = readFileSync(new URL(name, folder), 'utf8');
    assert.deepEqual(bareTriggerCases(sql), [], name);
  });

void test('pending command migrations preserve retained administrators and newsletter trigger behavior', (context) => {
  const db = memoryDb('0033_beehiiv_polling.sql');
  context.after(() => db.raw.close());
  db.raw.exec('PRAGMA foreign_keys=ON');
  for (const id of ['retained-one', 'retained-two']) {
    db.raw
      .prepare(
        "INSERT INTO people(id,email,membership_status,created_at,updated_at) VALUES(?,?,'member','2026-10-01','2026-10-01')",
      )
      .run(id, `${id}@example.invalid`);
    db.raw.prepare("INSERT INTO staff_administrators VALUES(?,'fixture','2026-10-01')").run(id);
  }
  for (const name of pending) {
    const sql = readFileSync(new URL(name, folder), 'utf8');
    // Wrangler's remote migration command appends this tracking INSERT to the
    // same SQL string. Rehearse every complete statement with its pinned splitter.
    const command = `${sql}\nINSERT INTO d1_migrations(name) VALUES('${name}');`;
    db.raw.exec('BEGIN');
    try {
      for (const statement of unstable_splitSqlQuery(command)) db.raw.exec(statement);
      db.raw.exec('COMMIT');
    } catch (error) {
      db.raw.exec('ROLLBACK');
      throw error;
    }
  }
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 2);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM staff_administrators').get()?.n, 2);
  assert.equal(
    db.raw.prepare('SELECT count(*) AS n FROM d1_migrations').get()?.n,
    migrations.length,
  );

  db.raw
    .exec(`INSERT INTO consent_records(id,person_id,scope,given_at,source,method,created_at,updated_at)
    VALUES('fresh-consent','retained-two','newsletter','2026-10-01','join_form','checkbox','2026-10-01','2026-10-01')`);
  const queued = () =>
    db.raw
      .prepare(
        "SELECT generation,state,activation_consent_id FROM newsletter_sync_jobs WHERE person_id='retained-two'",
      )
      .get();
  assert.equal(queued()?.activation_consent_id, 'fresh-consent');
  db.raw
    .exec(`INSERT INTO identities(id,person_id,platform,external_id,linked_at,link_method,created_at,updated_at)
    VALUES('newsletter-identity','retained-two','beehiiv','subscription-two','2026-10-01','verified_email','2026-10-01','2026-10-01')`);
  assert.equal(queued()?.activation_consent_id, 'fresh-consent');
  db.raw.exec("UPDATE consent_records SET withdrawn_at='2026-10-02' WHERE id='fresh-consent'");
  assert.equal(queued()?.activation_consent_id, null);
  assert.equal(queued()?.generation, 3);

  db.raw
    .exec(`INSERT INTO beehiiv_poll_checkpoints(publication_id,started_at,next_scan_at,next_attempt_at,in_progress)
    VALUES('publication','2026-10-01','2026-10-01','2026-10-01',0)`);
  for (const subscription of ['subscription-two', 'unlinked'])
    db.raw
      .prepare(
        "INSERT INTO beehiiv_subscription_observations VALUES('publication',?,'active','2026-10-01','2026-10-03','2026-10-03')",
      )
      .run(subscription);
  db.raw
    .exec(`UPDATE beehiiv_subscription_observations SET status='inactive',observed_at='2026-10-04'
    WHERE subscription_id='subscription-two'`);
  const choices = db.raw
    .prepare(
      'SELECT subscription_id,revision,status,baseline_active_at,state,reason FROM newsletter_poll_choices ORDER BY subscription_id',
    )
    .all();
  assert.deepEqual(
    choices.map((row) => [row.subscription_id, row.revision, row.state, row.reason]),
    [
      ['subscription-two', 2, 'pending', null],
      ['unlinked', 1, 'needs_review', 'unlinked_account'],
    ],
  );
  assert.equal(choices[0]?.baseline_active_at, '2026-10-03');
});
