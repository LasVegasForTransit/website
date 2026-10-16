import { resolve } from 'node:path';
import { preflightStaff } from './preflight';
import { MetadataClient } from './preflight-api';
import { previewSetupReady } from './preview-setup';
import { previewShutdownReady } from './preview-shutdown';
import { readJobsSchedule } from './release-schedule';
const args = process.argv.slice(2);
const environment = args.includes('--production') ? 'production' : 'preview';
if (
  args.some(
    (arg) => !['--production', '--preview', '--json', '--setup', '--shutdown'].includes(arg),
  ) ||
  ((args.includes('--setup') || args.includes('--shutdown')) && environment !== 'preview') ||
  (args.includes('--setup') && args.includes('--shutdown')) ||
  (args.includes('--production') && args.includes('--preview'))
) {
  console.error(
    'Usage: pnpm staff:preflight [--preview|--production] [--json] [--setup|--shutdown (preview only)]',
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
    const shutdown = args.includes('--shutdown');
    const client =
      options.accountId && options.token
        ? new MetadataClient({ ...options, accountId: options.accountId, token: options.token })
        : null;
    const ready = setup
      ? Boolean(client && (await previewSetupReady(options.root, client, report.checks)))
      : shutdown
        ? Boolean(
            client &&
            (await previewShutdownReady(options.root, client, report.checks, true)) &&
            (await readJobsSchedule(client, 'lvbt-jobs-preview')).length === 0,
          )
        : report.checks.every((check) => check.status === 'passed');
    if (args.includes('--json'))
      console.log(
        JSON.stringify(
          {
            ...report,
            ...(setup ? { stage: 'setup', setupReady: ready } : {}),
            ...(shutdown ? { stage: 'shutdown', shutdownReady: ready } : {}),
          },
          null,
          2,
        ),
      );
    else {
      if (setup)
        console.log(
          `PREVIEW SETUP ${ready ? 'READY' : 'NOT READY'}: provider work must remain disabled and jobs inactive. Launch checks follow.`,
        );
      if (shutdown)
        console.log(
          `PREVIEW SHUTDOWN ${ready ? 'READY' : 'NOT READY'}: provider work must be disabled and jobs unscheduled; prior requests may finish.`,
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
