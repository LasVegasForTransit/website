import { privateResponse } from '../src/lib/responses';
import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { issueFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import { loadActor } from '@lasvegasfortransit/platform-storage/staff-roles';
import { submitPaper } from '../src/lib/paper';
void test('native add adds five empty rows without changing entered values or creating records', async () => {
  const db = memoryDb();
  try {
    const { person } = await new PersonService(db).upsertFromSource({
      source: 'join_form',
      fields: { email: 'paper-staff@example.invalid' },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    });
    db.raw
      .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
      .run(person.id, 'fixture', new Date().toISOString());
    const actor = await loadActor(db, person.id);
    assert.ok(actor);
    const form = new URLSearchParams({
      token: await issueFormToken(db, actor, 'paper:submit'),
      batch_id: 'batch',
      intent: 'add',
      row_count: '5',
      event_name: 'CityNerd',
      event_date: '2026-10-01',
      wording_version: 'paper-v1',
      'rows.0.givenName': 'Ana',
      'rows.0.email': 'ana@example.invalid',
      'rows.0.newsletterConsent': 'on',
    });
    const result = await submitPaper(
      new Request('https://staff.lasvegasfortransit.org/paper/', { method: 'POST', body: form }),
      { db, actor, requestId: 'fixture' },
    );
    assert.ok(!(result instanceof Response));
    assert.equal(result.input.rows.length, 10);
    assert.equal(result.input.rows[0]?.givenName, 'Ana');
    assert.equal(result.input.rows[0]?.newsletterConsent, true);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM paper_batches').get()?.n, 0);
  } finally {
    db.raw.close();
  }
});

void test('only paper entry allows its local enhancement script', () => {
  for (const path of ['/people/', '/welcome/', '/paper/sheet/', '/paper/']) {
    const policy =
      privateResponse(new Response(''), path).headers.get('Content-Security-Policy') ?? '';
    assert.ok(policy.includes(path === '/paper/' ? "script-src 'self'" : "script-src 'none'"));
    assert.ok(!policy.includes('unsafe-inline'));
    assert.match(policy, /frame-ancestors 'none'/);
  }
});
