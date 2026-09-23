import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';

import { previewUploadReceipt } from '@lvbt/web-platform/release';

const execute = promisify(execFile);

const workerSecretNames = [
  'LVBT_BEEHIIV_API_KEY',
  'LVBT_BEEHIIV_PUBLICATION_ID',
  'LVBT_MEMBERSHIP_INTAKE_SECRET',
  'LVBT_NOTION_API_KEY',
  'LVBT_NOTION_DATA_SOURCE_ID',
  'LVBT_TRANSIT_NEWS_INTAKE_SECRET',
] as const;

function workerSecrets(): Record<string, string> {
  const entries = workerSecretNames.map((name) => [name, process.env[name]?.trim()] as const);
  const missing = entries.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0)
    throw new Error(`Set the Worker candidate secrets: ${missing.join(', ')}.`);
  return Object.fromEntries(entries) as Record<string, string>;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      alias: { type: 'string' },
      message: { type: 'string' },
      env: { type: 'string' },
      secrets: { type: 'boolean', default: false },
    },
  });
  const alias = values.alias;
  if (!alias || !/^[a-z][a-z0-9-]*$/.test(alias))
    throw new Error('Pass a lowercase Worker preview alias with --alias.');
  // Pull request previews use the `preview` environment: a separate Worker bound to the preview
  // database. Without --env the version is uploaded to the production Worker.
  const environment = values.env;
  if (environment !== undefined && environment !== 'preview')
    throw new Error('The only Worker environment is --env preview.');
  const workerName = environment ? `lvbt-website-${environment}` : 'lvbt-website';

  const directory = await mkdtemp(path.join(os.tmpdir(), 'lvbt-worker-preview-'));
  const receiptPath = path.join(directory, 'wrangler.jsonl');
  const secretsPath = path.join(directory, 'secrets.json');
  if (values.secrets)
    await writeFile(secretsPath, `${JSON.stringify(workerSecrets())}\n`, { mode: 0o600 });
  await execute(
    'pnpm',
    [
      'exec',
      'wrangler',
      'versions',
      'upload',
      '--preview-alias',
      alias,
      '--message',
      values.message ?? `Website preview ${alias}`,
      ...(environment ? ['--env', environment] : []),
      ...(values.secrets ? ['--secrets-file', secretsPath] : []),
    ],
    {
      env: {
        ...process.env,
        WRANGLER_LOG_SANITIZE: 'true',
        WRANGLER_OUTPUT_FILE_PATH: receiptPath,
      },
      maxBuffer: 16 * 1024 * 1024,
    },
  );

  const receipt = previewUploadReceipt(await readFile(receiptPath, 'utf8'), workerName);
  // eslint-disable-next-line turbo/no-undeclared-env-vars -- GitHub creates this step output file.
  const output = process.env.GITHUB_OUTPUT;
  if (output)
    await writeFile(output, `url=${receipt.url}\nversion=${receipt.version}\n`, { flag: 'a' });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

await main();
