import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeBeehiivCsv } from './roster-beehiiv-csv';
import { normalizeNotionRoster } from './roster-notion-csv';
import { normalizeApiRoster } from './roster-api-normalize';
import type { RosterSourceSnapshot } from './roster-source-export';
async function markdownPages(
  directory: string,
): Promise<Array<{ fileName: string; contents: string }>> {
  const pages: Array<{ fileName: string; contents: string }> = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) pages.push(...(await markdownPages(path)));
    else if (entry.name.endsWith('.md'))
      pages.push({ fileName: entry.name, contents: await readFile(path, 'utf8') });
  }
  return pages;
}
function options(args: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (
      !key ||
      !value ||
      result.has(key) ||
      ![
        '--beehiiv',
        '--notion',
        '--pages',
        '--google',
        '--google-metadata',
        '--sources-json',
        '--output',
        '--observed-at',
      ].includes(key)
    )
      throw new Error('Invalid normalization options');
    result.set(key, value);
  }
  return result;
}
export async function normalizeRosterCommand(args: string[]): Promise<number> {
  try {
    const opts = options(args),
      output = opts.get('--output');
    if (!output) throw new Error('Missing private output path');
    let records;
    const json = opts.get('--sources-json');
    if (json) {
      const snapshot = JSON.parse(await readFile(json, 'utf8')) as RosterSourceSnapshot;
      records = normalizeApiRoster(snapshot);
    } else {
      const beehiiv = opts.get('--beehiiv'),
        notion = opts.get('--notion'),
        pages = opts.get('--pages');
      if (!beehiiv || !notion || !pages) throw new Error('Missing original source export paths');
      const metadataPath = opts.get('--google-metadata'),
        googlePath = opts.get('--google');
      const metadata = metadataPath
        ? (JSON.parse(await readFile(metadataPath, 'utf8')) as {
            properties?: { timeZone?: string };
          })
        : undefined;
      records = [
        ...normalizeBeehiivCsv(await readFile(beehiiv, 'utf8'), opts.get('--observed-at') ?? ''),
        ...normalizeNotionRoster({
          csv: await readFile(notion, 'utf8'),
          pages: await markdownPages(pages),
          ...(googlePath ? { googleCsv: await readFile(googlePath, 'utf8') } : {}),
          ...(metadata?.properties?.timeZone
            ? { googleTimeZone: metadata.properties.timeZone }
            : {}),
        }),
      ];
    }
    await writeFile(output, JSON.stringify(records, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    process.stdout.write(
      `Source records normalized: ${records.length}\nAffirmative signup evidence: ${records.filter((row) => row.newsletter.affirmative === true).length}\n`,
    );
    return 0;
  } catch {
    process.stderr.write(
      'Normalization failed; verify original source files and their mapping. No member records were changed.\n',
    );
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await normalizeRosterCommand(process.argv.slice(2));
