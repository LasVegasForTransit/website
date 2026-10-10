import { execFile } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { verifyStaffRelease, type ReleaseIdentity } from './release-artifact';

const execute = promisify(execFile);
export async function checkStaffRelease(directory: string, identity: ReleaseIdentity) {
  await verifyStaffRelease(directory, identity);
  const temporary = await mkdtemp(join(tmpdir(), 'lvbt-staff-release-check-'));
  try {
    const copy = join(temporary, 'release');
    await cp(directory, copy, { recursive: true });
    for (const app of ['staff', 'jobs']) {
      for (const environment of ['preview', 'production']) {
        await execute(
          'pnpm',
          [
            'exec',
            'wrangler',
            'versions',
            'upload',
            '--dry-run',
            '--no-bundle',
            '--config',
            join(copy, app, `wrangler.${environment}.json`),
            '--outdir',
            join(temporary, `${app}-${environment}`),
          ],
          { maxBuffer: 16 * 1024 * 1024 },
        );
        process.stderr.write(`Checked ${app} ${environment} bundle.\n`);
      }
    }
    return await verifyStaffRelease(directory, identity);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
