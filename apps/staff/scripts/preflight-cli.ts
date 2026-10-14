import { resolve } from 'node:path';
import { preflightStaff } from './preflight';
import { MetadataClient } from './preflight-api';
import { previewSetupReady } from './preview-setup';
const args = process.argv.slice(2);
const environment = args.includes('--production') ? 'production' : 'preview';
if (
  args.some((arg) => !['--production', '--preview', '--json', '--setup'].includes(arg)) ||
  (args.includes('--setup') && environment !== 'preview') ||
  (args.includes('--production') && args.includes('--preview'))
) {
  console.error(
    'Usage: pnpm staff:preflight [--preview|--production] [--json] [--setup (preview only)]',
  );
  process.exitCode = 2;
} else {
  try {
    const options = {
      root: resolve(import.meta.dirname, '../../..'),
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      token: process.env.CLOUDFLARE_API_TOKEN,
    };
    const report = await preflightStaff(environment, options);
    const setup = args.includes('--setup');
    const ready = setup
      ? Boolean(
          options.accountId &&
          options.token &&
          (await previewSetupReady(
            options.root,
            new MetadataClient({ ...options, accountId: options.accountId, token: options.token }),
            report.checks,
          )),
        )
      : report.checks.every((check) => check.status === 'passed');
    if (args.includes('--json'))
      console.log(
        JSON.stringify(
          { ...report, ...(setup ? { stage: 'setup', setupReady: ready } : {}) },
          null,
          2,
        ),
      );
    else {
      if (setup)
        console.log(
          `PREVIEW SETUP ${ready ? 'READY' : 'NOT READY'}: provider work must remain disabled and jobs inactive. Launch checks follow.`,
        );
      for (const check of [...report.checks, ...report.acceptance])
        console.log(`${check.status.toUpperCase()} ${check.id}: ${check.detail}`);
    }
    process.exitCode = ready ? 0 : 1;
  } catch {
    console.error(
      'Staff configuration could not be read. Check Worker files and canonical migration paths.',
    );
    process.exitCode = 1;
  }
}
