import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareStaffRelease } from './release-download';
import { verifyStaffRelease } from './release-artifact';
import { assertReleaseSource } from './release-source';
import { uploadStaffRelease, activateStaffRelease } from './release-deploy';
import { runWrangler } from './release-provider';

export async function deployFromBuild(
  action: 'upload' | 'activate',
  values: Partial<
    Record<
      'directory' | 'repository' | 'run-id' | 'receipt' | 'target' | 'commit' | 'release-id',
      string
    >
  >,
) {
  if (
    !values.directory ||
    !values.repository ||
    !values['run-id'] ||
    !values.receipt ||
    values.target !== 'preview' ||
    values.commit ||
    values['release-id']
  )
    throw new Error(
      'Use upload or activate with --directory, --repository, --run-id, --receipt and --target preview. Production promotion requires separate acceptance.',
    );
  const root = resolve(import.meta.dirname, '../../..');
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token)
    throw new Error('Set explicit scoped Cloudflare deployment credentials.');
  const temporary = await mkdtemp(join(tmpdir(), 'lvbt-staff-build-'));
  try {
    const selected = await prepareStaffRelease({
      directory: join(temporary, 'release'),
      repository: values.repository,
      runId: values['run-id'],
    });
    const directory = resolve(values.directory);
    const saved = await verifyStaffRelease(directory, selected);
    if (saved.artifactHash !== selected.artifactHash) throw new Error('Selected artifact differs.');
    await assertReleaseSource(root, selected.commit);
    const options = {
      root,
      accountId,
      token,
      environment: 'preview' as const,
      run: async (args: string[], output: string) => {
        await assertReleaseSource(root, selected.commit);
        await runWrangler(args, output, { accountId, token }, root);
      },
    };
    const result = await (action === 'upload' ? uploadStaffRelease : activateStaffRelease)(
      directory,
      selected,
      resolve(values.receipt),
      options,
    );
    await assertReleaseSource(root, selected.commit);
    return result;
  } catch {
    throw new Error(
      'Release deployment stopped. Inspect the retained receipt, source checkout and provider configuration before retrying.',
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
