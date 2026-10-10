import { resolve } from 'node:path';
import { preflightStaff } from './preflight';
const args = process.argv.slice(2);
const environment = args.includes('--production') ? 'production' : 'preview';
if (
  args.some((arg) => !['--production', '--preview', '--json'].includes(arg)) ||
  (args.includes('--production') && args.includes('--preview'))
) {
  console.error('Usage: pnpm staff:preflight [--preview|--production] [--json]');
  process.exitCode = 2;
} else {
  try {
    const report = await preflightStaff(environment, {
      root: resolve(import.meta.dirname, '../../..'),
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      token: process.env.CLOUDFLARE_API_TOKEN,
    });
    if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else
      for (const check of [...report.checks, ...report.acceptance])
        console.log(`${check.status.toUpperCase()} ${check.id}: ${check.detail}`);
    process.exitCode = report.checks.every((check) => check.status === 'passed') ? 0 : 1;
  } catch {
    console.error(
      'Staff configuration could not be read. Check Worker files and canonical migration paths.',
    );
    process.exitCode = 1;
  }
}
