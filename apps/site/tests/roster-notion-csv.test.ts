import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeNotionRoster,
  NOTION_NEWSLETTER_QUESTION,
  type NotionRosterSource,
} from '../scripts/platform/roster-notion-csv';

const columns = [
  'Name',
  'Discord',
  'Email',
  'Raw response',
  'Response ID',
  'Source',
  'Submitted at',
];
const base: Record<string, string> = {
  Name: 'Alex María',
  Discord: 'synthetic.rider',
  Email: 'synthetic@example.invalid',
  'Raw response': 'https://example.invalid/original-response',
  'Response ID': 'synthetic-response',
  Source: 'Membership Sign-Up',
  'Submitted at': 'July 4, 2026 3:04 PM (PDT)',
};
const sourceId = '00112233445566778899aabbccddeeff';
const cell = (value: string) => `"${value.replaceAll('"', '""')}"`;
function csv(rows: Record<string, string>[], headers = columns) {
  return (
    [
      headers.map(cell).join(','),
      ...rows.map((row) => headers.map((key) => cell(row[key] ?? '')).join(',')),
    ].join('\r\n') + '\r\n'
  );
}
function page(row: Record<string, string>, id = sourceId, answer: string | null = 'Yes') {
  return {
    fileName: `${row.Name} ${id}.md`,
    contents: `# ${row.Name}\n\n${columns
      .filter((key) => key !== 'Name' && row[key])
      .map((key) => `${key}: ${row[key]}`)
      .join('\n')}\n\n${answer === null ? '' : `- ${NOTION_NEWSLETTER_QUESTION}: ${answer}\n`}`,
  };
}
function google(row: Record<string, string>, timestamp = '7/4/2026 15:04:05', answer = 'Yes') {
  return {
    Timestamp: timestamp,
    'Email Address': row.Email ?? '',
    [NOTION_NEWSLETTER_QUESTION]: answer,
  };
}
function source(row = base, timestamp = '7/4/2026 15:04:05'): NotionRosterSource {
  return {
    csv: csv([row]),
    pages: [page(row)],
    googleCsv: csv(
      [google(row, timestamp)],
      ['Timestamp', 'Email Address', NOTION_NEWSLETTER_QUESTION],
    ),
    googleTimeZone: 'America/Los_Angeles',
  };
}

void test('original Google seconds and exact answer establish consent only through a unique native page match', () => {
  const records = normalizeNotionRoster(source());
  assert.equal(records.length, 1);
  const record = records[0];
  assert.ok(record);
  assert.equal(record.sourceId, '00112233-4455-6677-8899-aabbccddeeff');
  assert.equal(record.source, 'notion_intake');
  assert.equal(record.email, base.Email);
  assert.equal(record.givenName, undefined);
  assert.equal(record.familyName, undefined);
  assert.equal(record.newsletter.state, 'active');
  assert.equal(record.newsletter.affirmative, true);
  assert.equal(record.newsletter.givenAt, '2026-07-04T22:04:05.000Z');
  assert.equal(record.newsletter.method, 'unknown');
  assert.equal(record.newsletter.wordingVersion, null);
  assert.equal(
    record.newsletter.wording,
    'Finishing this form will sign you up for our email newsletter. Is this okay?',
  );
  assert.equal(record.newsletter.answer, 'Yes');
  assert.deepEqual(record.form, {
    submittedAt: '2026-07-04T22:04:05.000Z',
    submissionMinute: '2026-07-04T15:04-07:00',
    sourceSubmittedAt: base['Submitted at'],
    originalResponseTimestamp: '7/4/2026 15:04:05',
    originalResponseTimeZone: 'America/Los_Angeles',
    membershipAffirmative: null,
    affirmativeAnswer: 'Yes',
    discordUsername: base.Discord,
    fullName: base.Name,
    responseId: base['Response ID'],
    rawResponseUrl: base['Raw response'],
    source: base.Source,
  });
});

void test('Notion minute precision, missing Google evidence or missing timezone cannot invent a choice time', () => {
  const original = source();
  assert.ok(original.googleCsv);
  for (const input of [
    { csv: original.csv, pages: original.pages },
    { csv: original.csv, pages: original.pages, googleCsv: original.googleCsv },
  ]) {
    const records = normalizeNotionRoster(input);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.newsletter.state, 'unknown');
    assert.equal(records[0].newsletter.affirmative, false);
    assert.equal(records[0].newsletter.givenAt, null);
    assert.equal(records[0].form?.submittedAt, null);
    assert.equal(records[0].form.affirmativeAnswer, 'Yes');
    assert.equal(records[0].form.membershipAffirmative, null);
    assert.equal(records[0].form.submissionMinute, '2026-07-04T15:04-07:00');
  }
});

void test('synthetic native export retains every row and duplicate email while only original precise Yes responses qualify', () => {
  const rows = Array.from({ length: 43 }, (_, index) => ({
    ...base,
    Name: `Synthetic ${index}`,
    Email: `synthetic${index === 42 ? 0 : index}@example.invalid`,
    'Submitted at': `July 4, 2026 3:${String(index).padStart(2, '0')} PM (PDT)`,
    Source: index < 23 ? 'Membership Sign-Up' : 'Membership Application',
    'Response ID': index < 23 ? `synthetic-response-${index}` : '',
    'Raw response': index < 23 ? `https://example.invalid/response-${index}` : '',
  }));
  const records = normalizeNotionRoster({
    csv: csv(rows),
    pages: rows.map((row, index) =>
      page(row, index.toString(16).padStart(32, '0'), index < 12 ? 'Yes' : null),
    ),
    googleCsv: csv(
      rows
        .slice(0, 23)
        .map((row, index) =>
          google(row, `7/4/2026 15:${String(index).padStart(2, '0')}:45`, index < 12 ? 'Yes' : ''),
        ),
      ['Timestamp', 'Email Address', NOTION_NEWSLETTER_QUESTION],
    ),
    googleTimeZone: 'America/Los_Angeles',
  });
  assert.equal(records.length, 43);
  assert.equal(new Set(records.map((record) => record.email)).size, 42);
  assert.equal(records.filter((record) => record.newsletter.affirmative).length, 12);
  assert.equal(records.filter((record) => record.newsletter.givenAt === null).length, 31);
  assert.equal(records.filter((record) => record.form?.submittedAt !== null).length, 23);
  assert.ok(records.every((record) => record.form?.membershipAffirmative === null));
});

void test('ambiguous original email and displayed minute correlations hold rather than reuse one response', () => {
  const input = source();
  const duplicateGoogle = {
    ...input,
    googleCsv: csv(
      [google(base), google(base, '7/4/2026 15:04:55')],
      ['Timestamp', 'Email Address', NOTION_NEWSLETTER_QUESTION],
    ),
  };
  const second = { ...base, Name: 'Another synthetic member' };
  const duplicateNotion = {
    ...input,
    csv: csv([base, second]),
    pages: [page(base), page(second, '11112233445566778899aabbccddeeff')],
  };
  for (const ambiguous of [duplicateGoogle, duplicateNotion]) {
    const records = normalizeNotionRoster(ambiguous);
    assert.ok(records.length > 0);
    assert.ok(
      records.every(
        (record) => record.newsletter.state === 'unknown' && record.newsletter.givenAt === null,
      ),
    );
  }
});

void test('DST folds and gaps hold the source time while an unambiguous winter instant retains seconds', () => {
  const cases: Array<[string, string, string | null, string | null]> = [
    ['November 1, 2026 1:30 AM (PDT)', '11/1/2026 1:30:10', null, '2026-11-01T01:30-07:00'],
    ['March 8, 2026 2:30 AM (PST)', '3/8/2026 2:30:10', null, null],
    [
      'November 1, 2026 3:30 AM (PST)',
      '11/1/2026 3:30:10',
      '2026-11-01T11:30:10.000Z',
      '2026-11-01T03:30-08:00',
    ],
  ];
  for (const [display, timestamp, expected, minute] of cases) {
    assert.ok(display && timestamp);
    const records = normalizeNotionRoster(source({ ...base, 'Submitted at': display }, timestamp));
    assert.equal(records.length, 1);
    assert.equal(records[0]?.newsletter.givenAt, expected);
    assert.equal(records[0].form?.originalResponseTimestamp, timestamp);
    assert.equal(records[0].form.submissionMinute, minute);
  }
});

void test('calendar rollover, wrong display-zone labels and contradictory original answers stay unconfirmed', () => {
  const invalidDate = source(
    { ...base, 'Submitted at': 'February 30, 2026 3:04 PM (PST)' },
    '2/30/2026 15:04:05',
  );
  const wrongLabel = source({ ...base, 'Submitted at': 'July 4, 2026 3:04 PM (PST)' });
  const contradictory = { ...source(), pages: [page(base, sourceId, 'No')] };
  for (const input of [invalidDate, wrongLabel, contradictory]) {
    const records = normalizeNotionRoster(input);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.newsletter.state, 'unknown');
    assert.equal(records[0].newsletter.givenAt, null);
  }
});

void test('a precise original Google time without the exact original newsletter question cannot confirm the Markdown answer', () => {
  const input = source();
  input.googleCsv = csv([google(base)], ['Timestamp', 'Email Address']);
  const records = normalizeNotionRoster(input);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.newsletter.state, 'unknown');
  assert.equal(records[0].newsletter.givenAt, null);
  assert.equal(records[0].form?.submittedAt, '2026-07-04T22:04:05.000Z');
});

void test('native page mismatches, missing pages and duplicate IDs fail without leaking member values', () => {
  const input = source();
  const second = { ...base, Name: 'Private synthetic name', Email: 'private@example.invalid' };
  const invalid = [
    { ...input, pages: [] },
    { ...input, pages: [page({ ...base, Name: 'Private synthetic name' })] },
    { ...input, pages: [page({ ...base, Email: 'private@example.invalid' })] },
    { ...input, pages: [page({ ...base, 'Submitted at': 'July 5, 2026 3:04 PM (PDT)' })] },
    { ...input, pages: [{ ...page(base), fileName: 'private-name-no-provider-id.md' }] },
    { ...input, csv: csv([base, second]), pages: [page(base), page(second)] },
    { ...input, googleCsv: 'Timestamp,Email Address\n"unclosed' },
    { ...input, googleTimeZone: 'UTC' },
    { ...input, csv: csv([base], [...columns, 'Unsupported field']) },
  ];
  for (const invalidSource of invalid) {
    assert.throws(
      () => normalizeNotionRoster(invalidSource),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /^Notion roster /);
        assert.doesNotMatch(error.message, /private|synthetic@example|00112233/);
        return true;
      },
    );
  }
});
