import { Zip, ZipPassThrough, strToU8 } from 'fflate/browser';
import { paperToday } from '@lasvegasfortransit/platform-core/paper';
import type { Actor } from '@lasvegasfortransit/platform-core/staff-types';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
import {
  collectFullExport,
  EXPORT_COLUMNS,
  type ExportRow,
  type FullExport,
  type ExportTable,
} from '@lasvegasfortransit/platform-storage/full-export';
function cell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\s]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
function* csv(columns: string[], rows: ExportRow[]): Generator<string> {
  yield columns.map(cell).join(',') + '\r\n';
  for (const row of rows) yield columns.map((column) => cell(row[column])).join(',') + '\r\n';
}
function* files(data: FullExport): Generator<{ name: string; contents: Iterable<string> }> {
  for (const [table, columns] of Object.entries(EXPORT_COLUMNS))
    yield { name: table + '.csv', contents: csv(columns.split(','), data[table as ExportTable]) };
  yield { name: 'export.json', contents: [JSON.stringify(data)] };
  yield {
    name: 'README.txt',
    contents: [
      'LVBT member records\nExported: ' +
        data.exportedAt +
        '\nFormat: 1\n\n' +
        'The four CSV files contain people, consent evidence, connected accounts and activity. Match records by id and person_id. Deleted people are excluded.\n' +
        'export.json contains the same records with original values, plus field sources, committee assignments, withdrawal requests, staff corrections and recorded Discord profiles. Empty CSV cells can be null or empty text; JSON preserves the distinction.\n' +
        'Import identifier, external_id, zip and census_block columns as Text before viewing or saving in a spreadsheet. Opening CSV files directly can remove leading zeros or round long account IDs. Original values remain in JSON.\n' +
        'CSV text that could run as a spreadsheet formula begins with an added apostrophe. Original values remain in JSON.\n' +
        'Sign-in codes, sessions, OAuth state and credentials are excluded. This download records a snapshot of LVBT records; connected-account entries do not prove current access on an external service.\n',
    ],
  };
}
function archive(data: FullExport): ReadableStream<Uint8Array> {
  const entries = files(data);
  let entry: { file: ZipPassThrough; contents: Iterator<string> } | undefined;
  let ended = false;
  let zip: Zip;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      zip = new Zip((error, chunk, final) => {
        if (error) controller.error(error);
        else {
          controller.enqueue(chunk);
          if (final) controller.close();
        }
      });
    },
    pull() {
      if (ended) return;
      if (!entry) {
        const next = entries.next();
        if (next.done) {
          ended = true;
          zip.end();
          return;
        }
        const file = new ZipPassThrough(next.value.name);
        zip.add(file);
        entry = { file, contents: next.value.contents[Symbol.iterator]() };
      }
      const chunk = entry.contents.next();
      entry.file.push(chunk.done ? new Uint8Array() : strToU8(chunk.value), chunk.done);
      if (chunk.done) entry = undefined;
    },
    cancel() {
      ended = true;
      zip.terminate();
    },
  });
}
export async function exportPeople(
  db: Db,
  actor: Actor,
  options: { now?: Date } = {},
): Promise<Response> {
  const now = options.now ?? new Date();
  const data = await collectFullExport(db, actor, now);
  if (!data)
    return new Response("You don't have access to this", {
      status: 403,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  return new Response(archive(data), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="lvbt-members-${paperToday(now)}.zip"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
