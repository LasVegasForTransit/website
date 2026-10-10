import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

void test('the roster preview CLI reports row conflicts without exposing source identities', async () => {
  const loaded = await import('../scripts/platform/import-roster').catch(() => null);
  assert.ok(loaded, 'staff need a read-only historical roster preview command');
  const directory = await mkdtemp(join(tmpdir(), 'lvbt-roster-preview-'));
  const sourcePath = join(directory, 'roster.json');
  try {
    await writeFile(
      sourcePath,
      JSON.stringify([
        {
          source: 'beehiiv',
          sourceId: 'private-subscriber-1',
          email: 'member@example.org',
          newsletter: { state: 'active', givenAt: '2025-01-02T09:00:00.000Z' },
        },
        {
          source: 'notion_intake',
          sourceId: 'private-page-2',
          email: 'former@example.org',
          newsletter: {
            state: 'withdrawn',
            givenAt: '2025-02-03T09:00:00.000Z',
            withdrawnAt: '2025-03-04T09:00:00.000Z',
          },
        },
        {
          source: 'beehiiv',
          sourceId: 'private-subscriber-3',
          email: 'member@example.org',
          newsletter: { state: 'active', givenAt: '2025-04-05T09:00:00.000Z' },
        },
      ]),
    );

    const report = await loaded.previewRosterFile(sourcePath, new Date('2026-10-09T12:00:00.000Z'));
    assert.deepEqual(report.counts, {
      records: 3,
      importablePeople: 1,
      activeMembers: 0,
      formerMembers: 1,
      unresolvedRecords: 0,
      conflictRecords: 2,
    });
    assert.deepEqual(
      report.records.map(({ index, classification }) => ({ index, classification })),
      [
        { index: 0, classification: 'conflict' },
        { index: 1, classification: 'ready' },
        { index: 2, classification: 'conflict' },
      ],
    );
    const output = JSON.stringify(report);
    assert.doesNotMatch(
      output,
      /member@example\.org|former@example\.org|private-(subscriber|page)/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('the roster preview CLI rejects apply and unknown options', async () => {
  const loaded = await import('../scripts/platform/import-roster').catch(() => null);
  assert.ok(loaded, 'staff need a read-only historical roster preview command');
  const errors: string[] = [];
  const exitCode = await loaded.runRosterImportCli(['--apply', '--input', '/private/roster.json'], {
    stdout: () => assert.fail('invalid options must not produce a report'),
    stderr: (message) => errors.push(message),
  });

  assert.equal(exitCode, 2);
  assert.match(errors.join('\n'), /Usage:/);
  assert.doesNotMatch(errors.join('\n'), /private\/roster\.json/);
});
