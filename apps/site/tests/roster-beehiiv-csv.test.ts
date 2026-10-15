import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BEEHIIV_ROSTER_COLUMNS,
  normalizeBeehiivCsv,
  parseRosterCsv,
} from '../scripts/platform/roster-beehiiv-csv';
import { previewRosterImport } from '../platform/roster-import';

const observedAt = '2026-10-14T12:00:00.000Z';
const base = {
  subscriber_id: 'synthetic-subscriber',
  api_subscription_id: 'sub_synthetic_stable',
  email: 'synthetic@example.invalid',
  status: 'active',
  created_at: '2025-03-01 14:20:30 UTC',
  updated_at: '2026-03-02 12:00:00 UTC',
  unsubscribed_at: '',
  'First Name': 'Zoë',
  'Last Name': 'García',
};
const cell = (value: string) => `"${value.replaceAll('"', '""')}"`;
function csv(rows: Record<string, string>[], columns: readonly string[] = BEEHIIV_ROSTER_COLUMNS) {
  return (
    [
      columns.map(cell).join(','),
      ...rows.map((row) => columns.map((key) => cell(row[key] ?? '')).join(',')),
    ].join('\r\n') + '\r\n'
  );
}

void test('shared source CSV parser preserves LF rows, quoted newlines and trailing empty cells', () => {
  assert.deepEqual(
    parseRosterCsv('\uFEFFName,Original answer,Optional\nZoë,"Yes, ""please""\nSecond line",'),
    [{ Name: 'Zoë', 'Original answer': 'Yes, "please"\nSecond line', Optional: '' }],
  );
  assert.deepEqual(parseRosterCsv('Name,Answer\r\n"",No\r\n'), [{ Name: '', Answer: 'No' }]);
});

void test('Beehiiv CSV preserves stable identities, accented names and exact quoted source facts', () => {
  const source = {
    ...base,
    campaign: 'Bus, bike and rail',
    acquisition_content: 'A "quoted" invitation\r\nSecond line',
    acquisition_source: '=HYPERLINK("https://example.invalid")',
    tags: '["community","transit"]',
    total_sent: '0007',
    last_opened_at: '2026-02-03 11:22:33',
  };
  const records = normalizeBeehiivCsv(`\uFEFF${csv([source])}`, observedAt);
  assert.equal(records.length, 1);
  const record = records[0];
  assert.ok(record);
  assert.equal(record.source, 'beehiiv');
  assert.equal(record.sourceId, source.api_subscription_id);
  assert.equal(record.email, source.email);
  assert.equal(record.givenName, 'Zoë');
  assert.equal(record.familyName, 'García');
  const original: Record<string, string> = source;
  assert.deepEqual(
    record.beehiiv,
    Object.fromEntries(BEEHIIV_ROSTER_COLUMNS.map((key) => [key, original[key] ?? ''])),
  );
  assert.equal(record.newsletter.sourceCreatedAt, '2025-03-01T14:20:30.000Z');
  assert.equal(record.newsletter.observedAt, observedAt);
  assert.equal(record.newsletter.evidenceReference, 'beehiiv full subscriber export');
});

void test('active provider status and creation time never become affirmative consent or choice time', () => {
  const records = normalizeBeehiivCsv(csv([base]), observedAt);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0]?.newsletter, {
    state: 'active',
    givenAt: null,
    affirmative: false,
    method: 'unknown',
    wordingVersion: null,
    withdrawnAt: null,
    withdrawnTimeBasis: 'observed',
    observedAt,
    sourceCreatedAt: '2025-03-01T14:20:30.000Z',
    evidenceReference: 'beehiiv full subscriber export',
  });
  const preview = previewRosterImport(records, { now: new Date(observedAt) });
  assert.equal(preview.counts.activeMembers, 1);
  assert.equal(preview.records[0]?.classification, 'ready');
  assert.equal(records[0].newsletter.givenAt, null);
  assert.equal(records[0].newsletter.affirmative, false);
});

void test('only explicit valid withdrawal times establish a withdrawal choice, while raw status survives', () => {
  const records = normalizeBeehiivCsv(
    csv([
      { ...base, status: 'inactive', unsubscribed_at: '2026-04-05 10:00:00 UTC' },
      { ...base, status: 'inactive' },
      { ...base, status: 'pending' },
      { ...base, status: 'other-provider-status' },
      { ...base, status: 'inactive', unsubscribed_at: '2026-02-30 10:00:00 UTC' },
      { ...base, status: 'inactive', unsubscribed_at: '2026-04-05 10:00:00' },
    ]),
    observedAt,
  );
  assert.equal(records.length, 6);
  assert.deepEqual(
    records.map((record) => record.newsletter.state),
    ['withdrawn', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown'],
  );
  assert.equal(records[0]?.newsletter.withdrawnAt, '2026-04-05T10:00:00.000Z');
  assert.equal(records[0].newsletter.withdrawnTimeBasis, 'choice');
  assert.equal(records[4]?.beehiiv?.unsubscribed_at, '2026-02-30 10:00:00 UTC');
  assert.equal(records[5]?.newsletter.withdrawnAt, null);
  assert.equal(records[3]?.beehiiv?.status, 'other-provider-status');
});

void test('contradictory active status and a withdrawal remain a conflict for staff review', () => {
  const records = normalizeBeehiivCsv(
    csv([{ ...base, unsubscribed_at: '2026-04-05 10:00:00 UTC' }]),
    observedAt,
  );
  const preview = previewRosterImport(records, { now: new Date(observedAt) });
  assert.equal(preview.records[0]?.classification, 'conflict');
  assert.ok(preview.records[0].reasons.includes('active_withdrawal_timestamp'));
});

void test('invalid calendar dates and timezone-less creation stay raw rather than getting coerced', () => {
  const records = normalizeBeehiivCsv(
    csv([
      { ...base, created_at: '2025-02-29 14:20:30 UTC' },
      { ...base, created_at: '2026-03-01 14:20:30' },
      { ...base, created_at: '2024-02-29 14:20:30 UTC' },
    ]),
    observedAt,
  );
  assert.equal(records.length, 3);
  assert.equal(records[0]?.newsletter.sourceCreatedAt, null);
  assert.equal(records[1]?.newsletter.sourceCreatedAt, null);
  assert.equal(records[2]?.newsletter.sourceCreatedAt, '2024-02-29T14:20:30.000Z');
  assert.equal(records[0].beehiiv?.created_at, '2025-02-29 14:20:30 UTC');
});

void test('synthetic full-export shape recognizes current members while preserving unknown historical evidence', () => {
  const rows = Array.from({ length: 43 }, (_, index) => ({
    ...base,
    api_subscription_id: `sub_synthetic_${index}`,
    email: `synthetic${index}@example.invalid`,
    status: index < 40 ? 'active' : index < 42 ? 'pending' : 'inactive',
    unsubscribed_at: index === 42 ? '2026-04-05 10:00:00 UTC' : '',
  }));
  const records = normalizeBeehiivCsv(csv(rows), observedAt);
  assert.equal(records.length, 43);
  assert.equal(records.filter((record) => record.newsletter.state === 'active').length, 40);
  assert.equal(records.filter((record) => record.newsletter.state === 'unknown').length, 2);
  assert.equal(records.filter((record) => record.newsletter.state === 'withdrawn').length, 1);
  const preview = previewRosterImport(records, { now: new Date(observedAt) });
  assert.equal(preview.counts.activeMembers, 40);
  assert.equal(preview.counts.formerMembers, 0);
  assert.equal(preview.counts.unresolvedRecords, 3);
});

void test('malformed CSV, missing stable IDs and unsupported columns fail without printing source values', () => {
  const invalid = [
    '',
    'api_subscription_id,email,status\n"unfinished',
    'api_subscription_id,email,status\n"sub"trailing,private@example.invalid,active',
    'api_subscription_id,email,status\nsub,private@example.invalid,active,extra',
    'api_subscription_id,email,email\nsub,private@example.invalid,other@example.invalid',
    csv([{ ...base, api_subscription_id: '' }]),
    csv([base], ['subscriber_id', 'email', 'status']),
    csv([base], [...BEEHIIV_ROSTER_COLUMNS, 'unsupported']),
    csv([{ ...base, acquisition_content: 'x'.repeat(2001) }]),
  ];
  for (const contents of invalid) {
    assert.throws(
      () => normalizeBeehiivCsv(contents, observedAt),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /^Beehiiv CSV /);
        assert.doesNotMatch(error.message, /private@example|synthetic|unfinished|trailing/);
        return true;
      },
    );
  }
  assert.throws(() => normalizeBeehiivCsv(csv([base]), '2026-02-30T12:00:00Z'), /observation time/);
});
