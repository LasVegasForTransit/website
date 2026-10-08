import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  buildLinkReport,
  mergeExternalReport,
  selectLinkReport,
  type LycheeReport,
} from './build-link-report';
import { withLocalWorker } from './local-worker';
import { publicLinkReport, type LinkReport } from '@lasvegasfortransit/web-platform/links';

const { values } = parseArgs({
  options: {
    'external-output': { type: 'string' },
    report: { type: 'string' },
    target: { type: 'string', default: 'local' },
  },
});
const dist = path.resolve('dist');
let report: LinkReport = { checked: 0, results: [], external: [] };
try {
  report = await selectLinkReport(values.target, {
    local: async () => {
      let localReport: LinkReport | undefined;
      await withLocalWorker(async (origin) => {
        localReport = await buildLinkReport(dist, origin);
      });
      if (!localReport) throw new Error('Compiled Worker produced no link report.');
      return localReport;
    },
    production: () =>
      publicLinkReport(
        'https://lasvegasfortransit.org',
        fetch,
        new Set(['https://lasvegasfortransit.org', 'https://www.lasvegasfortransit.org']),
      ),
  });
  if (values['external-output'])
    await writeFile(values['external-output'], `${[...report.external].sort().join('\n')}\n`);
  if (values.target === 'production') await checkExternal();
} catch (error) {
  report.results.push({
    url: values.target === 'production' ? 'https://lasvegasfortransit.org' : 'compiled-worker',
    status: 'error',
    diagnostic: error instanceof Error ? error.message : String(error),
  });
} finally {
  if (values.report) {
    await mkdir(path.dirname(values.report), { recursive: true });
    await writeFile(values.report, `${JSON.stringify(report, null, 2)}\n`);
  }
}
for (const failure of report.results.filter((entry) => entry.status !== 'pass'))
  process.stderr.write(`${failure.url}: ${failure.diagnostic}\n`);
process.stdout.write(
  `${values.target} link checks: ${report.checked} URLs checked; ${report.external.length} external URLs retained.\n`,
);
process.exitCode =
  report.checked > 0 && report.results.every((entry) => entry.status === 'pass') ? 0 : 1;

async function checkExternal(): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'lvbt-external-links-'));
  try {
    const input = path.join(directory, 'external.txt');
    const output = path.resolve('audit-lychee.json');
    await writeFile(input, `${report.external.join('\n')}\n`);
    await rm(output, { force: true });
    const checked = spawnSync(
      'lychee',
      [
        '--config',
        '.lychee.toml',
        '--cache',
        '--format',
        'json',
        '--output',
        output,
        input,
        'docs/**/*.md',
        'README.md',
      ],
      { cwd: path.resolve('../..'), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
    if (checked.error) throw checked.error;
    const data = JSON.parse(await readFile(output, 'utf8')) as LycheeReport;
    report = mergeExternalReport(report, data);
    if (checked.status !== 0 && data.errors === 0)
      throw new Error(`Lychee exited ${checked.status} without findings: ${checked.stderr}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
