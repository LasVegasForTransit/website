import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type FileDigest = [string, string];
export function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
export async function inventory(directory: string, relative = ''): Promise<FileDigest[]> {
  const location = join(directory, relative);
  const stat = await lstat(location);
  if (stat.isSymbolicLink()) throw new Error('Release contains a symbolic link.');
  if (stat.isFile()) return [[relative, digest(await readFile(location))]];
  if (!stat.isDirectory()) throw new Error('Unsupported release file.');
  const files: FileDigest[] = [];
  for (const entry of await readdir(location)) {
    if (relative === '' && entry === 'release.json') continue;
    files.push(...(await inventory(directory, relative ? `${relative}/${entry}` : entry)));
  }
  return files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
export async function copyFiles(source: string, destination: string, files: FileDigest[]) {
  for (const [name, expected] of files) {
    if (name !== '.assetsignore' && /(^|\/)(\..*|node_modules)(\/|$)/.test(name))
      throw new Error('Release contains an unexpected private file.');
    const content = await readFile(join(source, name));
    if (digest(content) !== expected) throw new Error('Build changed during packaging.');
    await mkdir(dirname(join(destination, name)), { recursive: true });
    await writeFile(join(destination, name), content, { flag: 'wx' });
  }
}
