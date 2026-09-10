import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';

import { previewUploadReceipt } from '@lvbt/web-platform/release';

const execute = promisify(execFile);

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      alias: { type: 'string' },
      message: { type: 'string' },
    },
  });
  const alias = values.alias;
  if (!alias || !/^[a-z][a-z0-9-]*$/.test(alias))
    throw new Error('Pass a lowercase Worker preview alias with --alias.');

  const directory = await mkdtemp(path.join(os.tmpdir(), 'lvbt-worker-preview-'));
  const receiptPath = path.join(directory, 'wrangler.jsonl');
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

  const receipt = previewUploadReceipt(await readFile(receiptPath, 'utf8'), 'lvbt-website');
  // eslint-disable-next-line turbo/no-undeclared-env-vars -- GitHub creates this step output file.
  const output = process.env.GITHUB_OUTPUT;
  if (output)
    await writeFile(output, `url=${receipt.url}\nversion=${receipt.version}\n`, { flag: 'a' });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

await main();
