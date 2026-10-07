import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { github, githubJson } from './github';
import { promotionRequest } from './promotion-request';
import { publicationSchema } from './publication';
import { waitForReleaseIdentity } from './release-identity';

const { values } = parseArgs({
  options: { 'run-id': { type: 'string' }, help: { type: 'boolean' } },
});
if (values.help) {
  process.stdout.write(
    'Usage: pnpm promote [--run-id <successful staging Actions run ID>]\nPromotes current preview by default, using GitHub environment credentials. Requires gh authentication with Actions write access.\n',
  );
} else {
  const repository = 'LasVegasForTransit/website';
  const repo = z
    .object({ nameWithOwner: z.literal(repository) })
    .parse(await githubJson(['repo', 'view', '--json', 'nameWithOwner']));
  const endpoint = `repos/${repo.nameWithOwner}/actions/workflows/deploy-worker-candidate.yml`;
  z.object({ state: z.literal('active') }).parse(await githubJson(['api', endpoint]));
  const requestId = randomUUID();
  process.stdout.write(
    `Request: ${requestId}\nResolving the selected preview release in GitHub Actions.\n`,
  );
  const run = await promotionRequest(requestId, values['run-id'], {
    dispatch: async (id, releaseId) => {
      const args = [
        'api',
        `${endpoint}/dispatches`,
        '--method',
        'POST',
        '-f',
        'ref=main',
        '-f',
        `inputs[request_id]=${id}`,
      ];
      if (releaseId) args.push('-f', `inputs[run_id]=${releaseId}`);
      await github(args);
    },
    listRuns: async () =>
      await githubJson([
        'api',
        `${endpoint}/runs?event=workflow_dispatch&branch=main&per_page=100`,
      ]),
    getRun: async (id) => await githubJson(['api', `repos/${repository}/actions/runs/${id}`]),
    progress: (current) => process.stdout.write(`${current.status}: ${current.html_url}\n`),
  });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lvbt-publication-'));
  try {
    try {
      await github([
        'run',
        'download',
        String(run.id),
        '--repo',
        repository,
        '--name',
        `publication-${run.id}-${run.run_attempt}`,
        '--dir',
        directory,
      ]);
    } catch {
      throw new Error(
        `Promotion ${run.conclusion}; publication receipt unavailable. Inspect ${run.html_url} before dispatching again.`,
      );
    }
    const receipt = publicationSchema.parse(
      JSON.parse(await readFile(path.join(directory, 'publication.json'), 'utf8')),
    );
    process.stdout.write(`${JSON.stringify({ run: run.html_url, ...receipt }, null, 2)}\n`);
    if (receipt.activation === 'confirmed')
      await waitForReleaseIdentity(receipt.url, receipt.release);
    if (
      run.conclusion !== 'success' ||
      receipt.activation !== 'confirmed' ||
      receipt.verification !== 'success'
    )
      throw new Error(
        `Promotion ${run.conclusion}; activation ${receipt.activation}; public verification ${receipt.verification}. Inspect ${run.html_url}. Do not blindly redispatch.`,
      );
    process.stdout.write(
      `Published release ${receipt.release.releaseId} at ${receipt.url}; live marker verified.\n`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
