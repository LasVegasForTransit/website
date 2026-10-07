import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { readReleaseIdentity, type ReleaseIdentity } from './release-identity';
import { publicationReceipt } from './publication';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    directory: { type: 'string' },
    commit: { type: 'string' },
    'release-id': { type: 'string' },
    'artifact-hash': { type: 'string' },
    version: { type: 'string' },
    activation: { type: 'string' },
    verification: { type: 'string' },
  },
});
if (!values.directory) throw new Error('Pass --directory.');
await mkdir(values.directory, { recursive: true });
const baselinePath = path.join(values.directory, 'baseline.json');
if (positionals[0] === 'baseline') {
  const identity = await readReleaseIdentity('https://lasvegasfortransit.org');
  await writeFile(baselinePath, `${JSON.stringify(identity, null, 2)}\n`);
} else if (positionals[0] === 'record') {
  if (!values.commit || !values['release-id']) throw new Error('Pass --commit and --release-id.');
  let baseline: ReleaseIdentity | null = null;
  try {
    baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as ReleaseIdentity;
  } catch {
    /* Baseline step may have failed; still retain the outcome. */
  }
  const receipt = publicationReceipt({
    release: { commit: values.commit, releaseId: values['release-id'] },
    baseline,
    artifactHash: values['artifact-hash'],
    version: values.version,
    activation: values.activation ?? '',
    verification: values.verification ?? '',
  });
  await writeFile(
    path.join(values.directory, 'publication.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  // eslint-disable-next-line turbo/no-undeclared-env-vars -- Actions supplies the summary file.
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary)
    await writeFile(
      summary,
      `### Website publication receipt\n\nRelease: ${receipt.release.releaseId}\n\nCommit: ${receipt.release.commit}\n\nBaseline: ${receipt.baseline?.releaseId ?? 'unavailable'}\n\nArtifact SHA-256: ${receipt.artifactHash ?? 'unavailable'}\n\nWorker version: ${receipt.version ?? 'unavailable'}\n\nActivation: ${receipt.activation}\n\nPublic verification: ${receipt.verification}\n\nPublic site: ${receipt.url}\n`,
      { flag: 'a' },
    );
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} else throw new Error('Use baseline or record.');
