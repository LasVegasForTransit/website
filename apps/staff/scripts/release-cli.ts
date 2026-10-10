import { execFile } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { packageStaffRelease, validateIdentity, verifyStaffRelease } from './release-artifact';
import { assertReleaseSource } from './release-source';
import { checkStaffRelease } from './release-dry-run';
import { validateReleaseConfiguration } from './release-config';
import { prepareStaffRelease } from './release-download';
import { deployFromBuild } from './release-deploy-cli';

const execute = promisify(execFile);
type Arguments = Partial<
  Record<
    'directory' | 'repository' | 'run-id' | 'commit' | 'release-id' | 'receipt' | 'target',
    string
  >
>;
async function prepare(values: Arguments) {
  if (
    !values.directory ||
    !values.repository ||
    !values['run-id'] ||
    values.commit ||
    values['release-id']
  )
    throw new Error('Use prepare with --directory, --repository and --run-id.');
  const prepared = await prepareStaffRelease({
    directory: resolve(values.directory),
    repository: values.repository,
    runId: values['run-id'],
  });
  // eslint-disable-next-line turbo/no-undeclared-env-vars -- Actions provides its output file.
  const output = process.env.GITHUB_OUTPUT;
  if (output)
    await writeFile(
      output,
      `commit=${prepared.commit}\nrelease-id=${prepared.releaseId}\nartifact-id=${prepared.artifactId}\nartifact-hash=${prepared.artifactHash}\n`,
      { flag: 'a' },
    );
  process.stdout.write(`${JSON.stringify(prepared)}\n`);
}
async function deployment(positionals: string[], values: Arguments) {
  if (positionals.length === 1 && (positionals[0] === 'upload' || positionals[0] === 'activate')) {
    process.stdout.write(`${JSON.stringify(await deployFromBuild(positionals[0], values))}\n`);
    return true;
  }
  if (values.receipt || values.target)
    throw new Error('Receipt and target options require upload or activate.');
  return false;
}
async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      directory: { type: 'string' },
      commit: { type: 'string' },
      'release-id': { type: 'string' },
      repository: { type: 'string' },
      'run-id': { type: 'string' },
      receipt: { type: 'string' },
      target: { type: 'string' },
    },
  });
  if (await deployment(positionals, values)) return;
  if (positionals.length === 1 && positionals[0] === 'prepare') {
    await prepare(values);
    return;
  }
  if (
    positionals.length !== 1 ||
    !['package', 'verify', 'check'].includes(positionals[0]) ||
    !values.directory ||
    !values.commit ||
    !values['release-id'] ||
    values.repository ||
    values['run-id']
  )
    throw new Error('Use package, verify or check with --directory, --commit and --release-id.');
  const identity = { commit: values.commit, releaseId: values['release-id'] };
  validateIdentity(identity);
  const directory = resolve(values.directory);
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  if (positionals[0] === 'package') {
    await assertReleaseSource(root, identity.commit);
    await validateReleaseConfiguration(root);
    for (const app of ['staff', 'jobs']) {
      await rm(resolve(root, 'apps', app, 'dist'), { recursive: true, force: true });
      await execute('pnpm', ['--dir', `apps/${app}`, 'run', 'build'], {
        cwd: root,
        maxBuffer: 16 * 1024 * 1024,
      });
      process.stderr.write(`Built ${app}.\n`);
    }
    await assertReleaseSource(root, identity.commit);
    await packageStaffRelease(root, directory, identity);
    try {
      await assertReleaseSource(root, identity.commit);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }
  const release =
    positionals[0] === 'check'
      ? await checkStaffRelease(directory, identity)
      : await verifyStaffRelease(directory, identity);
  process.stdout.write(
    `${JSON.stringify({ commit: release.commit, releaseId: release.releaseId, artifactHash: release.artifactHash, fileCount: release.files.length, migrations: release.migrations.map(([name]) => name) })}\n`,
  );
}
try {
  await main();
} catch (error) {
  // Build subprocess errors can contain provider values; never print raw command output here.
  process.stderr.write(
    `${error instanceof Error && !('cmd' in error) ? error.message : 'Release preparation failed.'}\n`,
  );
  process.exitCode = 1;
}
