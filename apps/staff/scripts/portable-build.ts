import { fileURLToPath } from 'node:url';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function portableBuildSource(code: string, root: URL) {
  return code
    .replaceAll(root.href, 'file:///lvbt/source/')
    .replaceAll(fileURLToPath(root), '/lvbt/source/');
}
export async function normalizeBuildPaths(server: URL, root: URL) {
  const directory = fileURLToPath(server);
  if (!(await lstat(directory)).isDirectory())
    throw new Error('Invalid compiled Worker directory.');
  for (const name of await readdir(directory, { recursive: true })) {
    if (!name.endsWith('.mjs') && !name.endsWith('.js')) continue;
    const location = join(directory, name);
    const stat = await lstat(location);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid compiled Worker module.');
    const code = await readFile(location, 'utf8');
    const portable = portableBuildSource(code, root);
    if (portable !== code) await writeFile(location, portable);
  }
}
