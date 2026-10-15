import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb, everyStoredText } from './support/platform-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';

void test('database dry run predicts actual matching and held queues without changing any target row', async () => {
  const { previewDatabaseRoster } = await import('../scripts/platform/roster-database');
  const { applyRosterImport } = await import('../platform/roster-import');
  const db = memoryDb();
  await new PersonService(db).upsertFromSource({
    source: 'staff',
    fields: { email: 'existing@example.invalid' },
  });
  const input = [
    {
      source: 'beehiiv',
      sourceId: 'sub_match',
      email: 'existing@example.invalid',
      newsletter: {
        state: 'active',
        affirmative: true,
        givenAt: '2026-03-01T12:00:00.000Z',
        method: 'double_opt_in',
      },
    },
    {
      source: 'notion_intake',
      sourceId: 'page_hold',
      email: 'unclear@example.invalid',
      newsletter: { state: 'unknown', givenAt: null },
    },
  ];
  const before = everyStoredText(db),
    options = { runId: 'preview', now: new Date('2026-10-14T12:00:00.000Z') };
  const preview = await previewDatabaseRoster(db, input, options);
  assert.equal(everyStoredText(db), before);
  assert.equal(preview.peopleCreated, 1);
  assert.equal(preview.reviewItemsCreated, 2);
  assert.equal(preview.consentRecordsCreated, 0);
  await applyRosterImport(db, input, options);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 2);
  const second = await previewDatabaseRoster(db, input, options);
  assert.equal(second.peopleCreated, 0);
  assert.equal(second.skipped, 2);
  assert.equal(second.reviewItemsCreated, 0);
  db.raw.close();
});
