import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  previewRosterImport,
  type RosterImportClassification,
  type RosterImportPreview,
} from '../../platform/roster-import';

export interface SafeRosterPreview {
  readOnly: true;
  counts: RosterImportPreview['counts'];
  records: Array<{
    index: number;
    classification: RosterImportClassification;
    reasons: string[];
  }>;
}

class RosterInputError extends Error {}

/** Read a normalized roster JSON array and return a report without contact or provider IDs. */
export async function previewRosterFile(
  inputPath: string,
  now = new Date(),
): Promise<SafeRosterPreview> {
  let contents: string;
  try {
    contents = await readFile(inputPath, 'utf8');
  } catch {
    throw new RosterInputError('Could not read the roster input file.');
  }

  let records: unknown;
  try {
    records = JSON.parse(contents);
  } catch {
    throw new RosterInputError('Roster input must be valid JSON.');
  }
  if (!Array.isArray(records)) throw new RosterInputError('Roster input must be a JSON array.');

  const preview = previewRosterImport(records, { now });
  return {
    readOnly: true,
    counts: preview.counts,
    records: preview.records.map(({ index, classification, reasons }) => ({
      index,
      classification,
      reasons,
    })),
  };
}

export interface RosterPreviewIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

const processIo: RosterPreviewIo = {
  stdout: (message) => process.stdout.write(`${message}\n`),
  stderr: (message) => process.stderr.write(`${message}\n`),
};

export async function runRosterImportCli(
  args: string[],
  io: RosterPreviewIo = processIo,
): Promise<number> {
  if (args.length !== 2 || args[0] !== '--input' || !args[1]?.trim()) {
    io.stderr('Usage: pnpm roster:preview --input <normalized-roster.json>');
    return 2;
  }

  try {
    const report = await previewRosterFile(args[1]);
    io.stdout(JSON.stringify(report, null, 2));
    return 0;
  } catch (error) {
    io.stderr(
      error instanceof RosterInputError
        ? error.message
        : 'Roster preview failed. No source data was changed.',
    );
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await runRosterImportCli(process.argv.slice(2));
