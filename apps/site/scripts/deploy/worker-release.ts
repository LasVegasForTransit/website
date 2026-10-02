import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { previewUploadReceipt } from '@lasvegasfortransit/web-platform/release';
import { packageRelease, verifyRelease, type WebsiteRelease } from './release-artifact';
import { releaseSource } from './release-source';

const execute = promisify(execFile);
function printRelease(release: WebsiteRelease): void {
  process.stdout.write(
    `${JSON.stringify({ commit: release.commit, releaseId: release.releaseId, artifactHash: release.artifactHash, fileCount: release.files.length })}\n`,
  );
}
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    directory: { type: 'string' },
    commit: { type: 'string' },
    'release-id': { type: 'string' },
    target: { type: 'string' },
    version: { type: 'string' },
    'run-file': { type: 'string' },
    repository: { type: 'string' },
    'run-id': { type: 'string' },
  },
});
const command = positionals[0];
const directory = values.directory ? path.resolve(values.directory) : undefined;
const target = values.target;
if (command === 'source') {
  if (!values['run-file'] || !values.repository || !values['run-id'])
    throw new Error('Pass --run-file, --repository and --run-id.');
  const source = releaseSource(
    JSON.parse(await readFile(values['run-file'], 'utf8')),
    values.repository,
    values['run-id'],
  );
  // eslint-disable-next-line turbo/no-undeclared-env-vars -- Actions provides this output file.
  const output = process.env.GITHUB_OUTPUT;
  if (output)
    await writeFile(output, `commit=${source.commit}\nrelease-id=${source.releaseId}\n`, {
      flag: 'a',
    });
  process.stdout.write(`${JSON.stringify(source)}\n`);
} else if (command === 'package') {
  if (!directory || !values.commit || !values['release-id'])
    throw new Error('Pass --directory, --commit and --release-id.');
  printRelease(
    await packageRelease(process.cwd(), directory, {
      commit: values.commit,
      releaseId: values['release-id'],
    }),
  );
} else if (command === 'verify' || command === 'upload') {
  if (!directory) throw new Error('Pass --directory.');
  const release = await verifyRelease(directory);
  if (values.commit && release.commit !== values.commit)
    throw new Error('Release commit does not match the selected Actions run.');
  if (values['release-id'] && release.releaseId !== values['release-id'])
    throw new Error('Release ID does not match the selected Actions run.');
  if (command === 'verify') {
    printRelease(release);
  } else {
    if (target !== 'preview' && target !== 'production')
      throw new Error('Pass --target preview or production.');
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'lvbt-release-upload-'));
    try {
      // Wrangler may write cache files; its working copy cannot modify the saved release.
      const copy = path.join(temporary, 'release');
      await cp(directory, copy, { recursive: true });
      const receiptPath = path.join(temporary, 'receipt.jsonl');
      await execute(
        'pnpm',
        [
          'exec',
          'wrangler',
          'versions',
          'upload',
          '--config',
          path.join(copy, 'wrangler.jsonc'),
          '--env',
          target === 'preview' ? 'preview' : '',
          '--no-bundle',
          '--preview-alias',
          `release-${release.releaseId}`,
          '--message',
          `Release ${release.releaseId} at ${release.commit}`,
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
      const receipt = previewUploadReceipt(
        await readFile(receiptPath, 'utf8'),
        target === 'preview' ? 'lvbt-website-preview' : 'lvbt-website',
      );
      // eslint-disable-next-line turbo/no-undeclared-env-vars -- Actions provides this output file.
      const output = process.env.GITHUB_OUTPUT;
      if (output)
        await writeFile(output, `url=${receipt.url}\nversion=${receipt.version}\n`, { flag: 'a' });
      process.stdout.write(
        `${JSON.stringify({ ...receipt, releaseId: release.releaseId, commit: release.commit, artifactHash: release.artifactHash })}\n`,
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
} else if (command === 'activate') {
  if (target !== 'preview' && target !== 'production')
    throw new Error('Pass --target preview or production.');
  if (!values.version || !/^[a-f0-9-]{36}$/.test(values.version))
    throw new Error('Pass an explicit Worker version ID.');
  const { stdout } = await execute(
    'pnpm',
    [
      'exec',
      'wrangler',
      'versions',
      'deploy',
      `${values.version}@100%`,
      '--name',
      target === 'preview' ? 'lvbt-website-preview' : 'lvbt-website',
      '--env',
      target === 'preview' ? 'preview' : '',
      '--yes',
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  process.stdout.write(stdout);
} else throw new Error('Use package, verify, upload, or activate.');
