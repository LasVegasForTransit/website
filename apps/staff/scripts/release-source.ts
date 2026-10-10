import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export async function assertReleaseSource(root: string, commit: string) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Pass a full source commit.');
  const git = async (args: string[]) => (await execute('git', args, { cwd: root })).stdout.trim();
  if (
    (await realpath(await git(['rev-parse', '--show-toplevel']))) !== (await realpath(root)) ||
    (await git(['rev-parse', 'HEAD'])) !== commit
  )
    throw new Error('The source commit must match the selected checkout.');
  if (await git(['status', '--porcelain', '--untracked-files=all']))
    throw new Error('Release packaging requires a clean checkout of the selected source commit.');
}
