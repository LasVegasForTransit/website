import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identitySchema = z
  .object({
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    releaseId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  })
  .strict();
const releaseSchema = identitySchema
  .extend({
    formatVersion: z.literal(1),
    artifactHash: digest,
    files: z.array(z.tuple([z.string().min(1), digest])),
  })
  .strict();
export type WebsiteRelease = z.infer<typeof releaseSchema>;
type Identity = z.infer<typeof identitySchema>;

function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

async function inventory(directory: string, relative = ''): Promise<[string, string][]> {
  const stat = await lstat(path.join(directory, relative));
  if (stat.isSymbolicLink()) throw new Error('Release content contains a symbolic link.');
  if (stat.isFile()) return [[relative, hash(await readFile(path.join(directory, relative)))]];
  if (!stat.isDirectory()) throw new Error('Unsupported release file type.');
  const files: [string, string][] = [];
  for (const entry of await readdir(path.join(directory, relative))) {
    if (relative === '' && entry === 'release.json') continue;
    const child = relative ? `${relative}/${entry}` : entry;
    files.push(...(await inventory(directory, child)));
  }
  return files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function artifactHash(identity: Identity, files: [string, string][]): string {
  return hash(
    JSON.stringify({
      formatVersion: 1,
      commit: identity.commit,
      releaseId: identity.releaseId,
      files,
    }),
  );
}

export async function packageRelease(
  source: string,
  destination: string,
  identity: Identity,
): Promise<WebsiteRelease> {
  identitySchema.parse(identity);
  const assets = await inventory(path.join(source, 'dist'));
  await inventory(path.join(source, '.wrangler/worker'));
  const config = await lstat(path.join(source, 'wrangler.jsonc'));
  if (config.isSymbolicLink() || !config.isFile())
    throw new Error('Invalid release configuration.');
  if (
    assets.some(([name]) => /^(patterns|prototypes)(\/|$)/.test(name)) ||
    (await readdir(path.join(source, 'dist'))).some((name) =>
      ['patterns', 'prototypes'].includes(name),
    )
  ) {
    throw new Error('Release contains preview-only routes.');
  }
  for (const [name] of assets.filter(([file]) => file.endsWith('.html'))) {
    if ((await readFile(path.join(source, 'dist', name), 'utf8')).includes('lang="en-XA"'))
      throw new Error('Release contains a preview-only test language.');
  }
  await mkdir(destination, { recursive: false });
  await cp(path.join(source, 'dist'), path.join(destination, 'dist'), { recursive: true });
  await mkdir(path.join(destination, '.wrangler'));
  await cp(path.join(source, '.wrangler/worker'), path.join(destination, '.wrangler/worker'), {
    recursive: true,
  });
  await cp(path.join(source, 'wrangler.jsonc'), path.join(destination, 'wrangler.jsonc'));
  await writeFile(
    path.join(destination, 'dist/lvbt-release.json'),
    `${JSON.stringify(identity)}\n`,
  );
  const files = await inventory(destination);
  if (
    !files.some(([name]) => name === 'dist/index.html') ||
    !files.some(([name]) => name === '.wrangler/worker/index.js')
  )
    throw new Error('Release requires the home page and compiled Worker.');
  const release: WebsiteRelease = {
    formatVersion: 1,
    ...identity,
    files,
    artifactHash: artifactHash(identity, files),
  };
  await writeFile(path.join(destination, 'release.json'), `${JSON.stringify(release, null, 2)}\n`, {
    flag: 'wx',
  });
  return release;
}

export async function verifyRelease(directory: string): Promise<WebsiteRelease> {
  const marker = await lstat(path.join(directory, 'release.json'));
  if (marker.isSymbolicLink() || !marker.isFile()) throw new Error('Invalid release manifest.');
  const release = releaseSchema.parse(
    JSON.parse(await readFile(path.join(directory, 'release.json'), 'utf8')),
  );
  const files = await inventory(directory);
  if (
    JSON.stringify(files) !== JSON.stringify(release.files) ||
    artifactHash(release, files) !== release.artifactHash
  )
    throw new Error('Release identity or files do not match the reviewed artifact.');
  if (
    !files.some(([name]) => name === 'dist/index.html') ||
    !files.some(([name]) => name === '.wrangler/worker/index.js') ||
    !files.some(([name]) => name === 'wrangler.jsonc')
  )
    throw new Error('Release is incomplete.');
  return release;
}
