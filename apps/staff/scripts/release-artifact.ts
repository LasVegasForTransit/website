import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { object } from './preflight-api';
import { copyFiles, digest, inventory, type FileDigest } from './release-files';
import { portableConfiguration, validateReleaseConfiguration } from './release-config';

export interface ReleaseIdentity {
  commit: string;
  releaseId: string;
}
export interface StaffRelease extends ReleaseIdentity {
  formatVersion: 1;
  artifactHash: string;
  files: FileDigest[];
  migrations: FileDigest[];
}
export function validateIdentity(identity: ReleaseIdentity) {
  if (!/^[a-f0-9]{40}$/.test(identity.commit) || !/^[1-9][0-9]*$/.test(identity.releaseId))
    throw new Error('Pass a full source commit and numeric Actions run ID.');
}
function artifactHash(release: Omit<StaffRelease, 'artifactHash'>) {
  return digest(
    JSON.stringify({
      formatVersion: 1,
      commit: release.commit,
      releaseId: release.releaseId,
      files: release.files,
      migrations: release.migrations,
    }),
  );
}
function migrationFiles(files: FileDigest[]) {
  const migrations = files.filter(([name]) => name.startsWith('migrations/'));
  if (
    !migrations.length ||
    migrations.some(
      ([name], i) =>
        !new RegExp(`^migrations/${String(i + 1).padStart(4, '0')}_[a-z0-9_]+\\.sql$`).test(name),
    )
  )
    throw new Error('Release requires the complete canonical migration sequence.');
  return migrations;
}
async function copyBuilds(source: string, destination: string) {
  const staff = join(source, 'apps/staff/dist/server');
  const staffFiles = (await inventory(staff)).filter(([name]) => name !== 'wrangler.json');
  if (
    !staffFiles.some(([name]) => name === 'entry.mjs') ||
    staffFiles.some(([name]) => !/\.(mjs|js)$/.test(name))
  )
    throw new Error('Staff release requires compiled Worker modules.');
  await copyFiles(staff, join(destination, 'staff/worker'), staffFiles);
  const assets = join(source, 'apps/staff/dist/client');
  const assetFiles = await inventory(assets);
  if (!assetFiles.length) throw new Error('Staff release requires assets.');
  await copyFiles(assets, join(destination, 'staff/assets'), assetFiles);
  const jobs = join(source, 'apps/jobs/dist');
  const jobsFiles = (await inventory(jobs)).filter(([name]) => name.endsWith('.js'));
  if (!jobsFiles.some(([name]) => name === 'index.js'))
    throw new Error('Jobs release requires a compiled Worker.');
  await copyFiles(jobs, join(destination, 'jobs/worker'), jobsFiles);
}
export async function packageStaffRelease(
  source: string,
  destination: string,
  identity: ReleaseIdentity,
): Promise<StaffRelease> {
  validateIdentity(identity);
  const location = relative(resolve(source), resolve(destination));
  if (!location || (location !== '..' && !location.startsWith('../') && !isAbsolute(location)))
    throw new Error('Save releases outside the source checkout.');
  await validateReleaseConfiguration(source);
  await mkdir(destination, { recursive: false });
  try {
    await copyBuilds(source, destination);
    const migrations = join(source, 'packages/platform-storage/migrations');
    await copyFiles(
      migrations,
      join(destination, 'migrations'),
      (await inventory(migrations)).filter(([name]) => name.endsWith('.sql')),
    );
    for (const app of ['staff', 'jobs'] as const) {
      for (const environment of ['preview', 'production'] as const) {
        await writeFile(
          join(destination, app, `wrangler.${environment}.json`),
          `${JSON.stringify(await portableConfiguration(source, app, environment), null, 2)}\n`,
          { flag: 'wx' },
        );
      }
    }
    const files = await inventory(destination);
    const content = {
      formatVersion: 1 as const,
      ...identity,
      files,
      migrations: migrationFiles(files),
    };
    const release = { ...content, artifactHash: artifactHash(content) };
    await writeFile(join(destination, 'release.json'), `${JSON.stringify(release, null, 2)}\n`, {
      flag: 'wx',
    });
    return release;
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}
export async function verifyStaffRelease(
  directory: string,
  expected: ReleaseIdentity,
): Promise<StaffRelease> {
  validateIdentity(expected);
  const manifest = join(directory, 'release.json');
  const stat = await lstat(manifest);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid release manifest.');
  const release = object(JSON.parse(await readFile(manifest, 'utf8')));
  const files = await inventory(directory);
  const content = {
    formatVersion: 1 as const,
    ...expected,
    files,
    migrations: migrationFiles(files),
  };
  if (
    JSON.stringify(Object.keys(release).sort()) !==
      JSON.stringify([
        'artifactHash',
        'commit',
        'files',
        'formatVersion',
        'migrations',
        'releaseId',
      ]) ||
    release.formatVersion !== 1 ||
    release.commit !== expected.commit ||
    release.releaseId !== expected.releaseId ||
    JSON.stringify(release.files) !== JSON.stringify(files) ||
    JSON.stringify(release.migrations) !== JSON.stringify(content.migrations) ||
    release.artifactHash !== artifactHash(content)
  )
    throw new Error('Release identity or content differs from the selected saved artifact.');
  for (const file of [
    'staff/worker/entry.mjs',
    'jobs/worker/index.js',
    ...['staff', 'jobs'].flatMap((app) =>
      ['preview', 'production'].map((environment) => `${app}/wrangler.${environment}.json`),
    ),
  ]) {
    if (!files.some(([name]) => name === file)) throw new Error('Release is incomplete.');
  }
  return { ...content, artifactHash: artifactHash(content) };
}
