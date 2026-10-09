import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const workflowUrl = new URL(
  '../../../.github/workflows/deploy-worker-candidate.yml',
  import.meta.url,
);
const previewWorkflowUrl = new URL(
  '../../../.github/workflows/deploy-worker-preview.yml',
  import.meta.url,
);
const previewPublisherUrl = new URL(
  '../../../.github/workflows/publish-worker-preview.yml',
  import.meta.url,
);
const stagingWorkflowUrl = new URL(
  '../../../.github/workflows/deploy-production.yml',
  import.meta.url,
);

void test('site scripts provide no direct production upload or deploy bypass', async () => {
  const { scripts } = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { scripts: Record<string, string> };
  assert.equal(scripts['worker:upload'], undefined);
  assert.equal(scripts['worker:deploy'], undefined);
  assert.equal(scripts['worker:promote'], 'pnpm --dir ../.. promote');
});

void test('required Turbo validation includes uncached dependency and secret gates', async () => {
  const rootPackage = JSON.parse(
    await readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
  ) as { scripts: Record<string, string> };
  assert.equal(rootPackage.scripts['security:secrets'], 'lvbt check secrets');
  assert.equal(
    rootPackage.scripts['security:dependencies'],
    'pnpm audit --prod --audit-level=high',
  );
  const rootTurbo = JSON.parse(
    await readFile(new URL('../../../turbo.json', import.meta.url), 'utf8'),
  ) as { tasks: Record<string, { cache: boolean }> };
  const siteTurbo = JSON.parse(
    await readFile(new URL('../turbo.json', import.meta.url), 'utf8'),
  ) as { tasks: { validate: { dependsOn: string[] } } };
  for (const name of ['security:secrets', 'security:dependencies']) {
    assert.equal(rootTurbo.tasks[`//#${name}`]?.cache, false);
    assert.ok(siteTurbo.tasks.validate.dependsOn.includes(`//#${name}`));
  }
});

void test('CI runs the required gate with full history and no duplicate security engines', async () => {
  const workflow = await readFile(
    new URL('../../../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /name: Validate/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /run: pnpm check/);
  assert.doesNotMatch(
    workflow,
    /name: Dependency audit|name: Secret scan|docker run|run: pnpm audit/,
  );
});

void test('production promotion uses shared selected-release verification and never rebuilds', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /run_id:/);
  assert.match(
    workflow,
    /expected_version:\s+description:\s+[^\n]+\s+type: string\s+required: false/,
  );
  assert.match(workflow, /expected-version: \$\{\{ inputs.expected_version \}\}/);
  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.match(
    workflow,
    /repository-tooling\/\.github\/workflows\/release-source\.yml@[a-f0-9]{40}/,
  );
  assert.match(
    workflow,
    /repository-tooling\/\.github\/workflows\/release-publish\.yml@[a-f0-9]{40}/,
  );
  assert.match(workflow, /release-id: \$\{\{ needs.source.outputs.release-id \}\}/);
  assert.match(workflow, /commit: \$\{\{ needs.source.outputs.commit \}\}/);
  assert.match(workflow, /target: production/);
  assert.match(workflow, /legacy-artifact: \$\{\{ needs.source.outputs.legacy == 'true' \}\}/);
  assert.match(workflow, /browser-script: worker:test:browser/);
  assert.match(workflow, /browser-project: ui-contracts/);
  assert.doesNotMatch(workflow, /pnpm build|pnpm check\s|wrangler deploy|worker:deploy/);
});
void test('promotable builds use shared typed artifact preparation and required analytics', async () => {
  const workflow = await readFile(stagingWorkflowUrl, 'utf8');
  assert.match(
    workflow,
    /repository-tooling\/\.github\/workflows\/release-build\.yml@[a-f0-9]{40}/,
  );
  assert.match(workflow, /artifact-source: typed-worker/);
  assert.match(workflow, /require-analytics: true/);
  assert.match(workflow, /app-directory: apps\/site/);
  assert.match(workflow, /validation-browser-directory: apps\/site/);
  assert.match(workflow, /artifact-prefix: website-release/);
  assert.doesNotMatch(workflow, /\.github\/actions\/build-site|worker:release package/);
});
void test('PR builds preserve analytics without deployment credentials or write permissions', async () => {
  const workflow = await readFile(previewWorkflowUrl, 'utf8');
  assert.match(workflow, /release-pr-preview-build\.yml@[a-f0-9]{40}/);
  assert.match(workflow, /require-analytics: true/);
  assert.match(workflow, /preview-pages: true/);
  assert.match(workflow, /validation-browser-directory: apps\/site/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /secrets:|environment:|: write|steps:|wrangler/);
});
void test('PR publication runs through the trusted main publisher and preview acceptance', async () => {
  const workflow = await readFile(previewPublisherUrl, 'utf8');
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows: \[Deploy Worker preview\]/);
  assert.match(workflow, /types: \[completed\]/);
  assert.match(workflow, /release-pr-preview-publish\.yml@[a-f0-9]{40}/);
  assert.match(workflow, /build-workflow: \.github\/workflows\/deploy-worker-preview\.yml/);
  assert.match(workflow, /preview-environment: worker-preview/);
  assert.match(workflow, /acceptance-directory: apps\/site/);
  assert.match(workflow, /smoke-script: worker:smoke/);
  assert.match(workflow, /browser-script: worker:test:browser/);
  assert.match(workflow, /browser-project: ui-contracts/);
  assert.doesNotMatch(workflow, /steps:|wrangler|upload-artifact|attestations: write/);
});
void test('main updates staging through shared publication and never activates production', async () => {
  const workflow = await readFile(stagingWorkflowUrl, 'utf8');
  assert.match(workflow, /name: Deploy staging/);
  assert.match(workflow, /needs: \[build, attest\]/);
  assert.match(workflow, /target: preview/);
  assert.match(
    workflow,
    /repository-tooling\/\.github\/workflows\/release-publish\.yml@[a-f0-9]{40}/,
  );
  assert.match(workflow, /browser-script: worker:test:browser/);
  assert.match(workflow, /browser-project: ui-contracts/);
  assert.doesNotMatch(workflow, /target: production|deploy-cloudflare-pages/);
});

void test('staging and production require proof signed by the same pinned shared workflow', async () => {
  const staging = await readFile(stagingWorkflowUrl, 'utf8');
  const promotion = await readFile(workflowUrl, 'utf8');
  const match = /release-attest\.yml@([a-f0-9]{40})/.exec(staging);
  assert.ok(match);
  assert.match(staging, /attestations: write/);
  assert.match(staging, /id-token: write/);
  for (const workflow of [staging, promotion])
    assert.match(workflow, /attestation-prefix: attestation-website-release/);
  const tooling = JSON.parse(
    await readFile(new URL('../../../.lvbt/tooling.json', import.meta.url), 'utf8'),
  ) as {
    release: {
      attestation: {
        signerWorkflow: string;
        signerCommit: string;
        legacyArtifacts: Array<{
          runId: string;
          sourceCommit: string;
          artifactId: number;
          expiresAt: string;
        }>;
      };
    };
  };
  assert.equal(tooling.release.attestation.signerCommit, match[1]);
  assert.equal(
    tooling.release.attestation.signerWorkflow,
    'LasVegasForTransit/repository-tooling/.github/workflows/release-attest.yml',
  );
  const retained = tooling.release.attestation.legacyArtifacts;
  assert.equal(retained.length, 16);
  assert.equal(new Set(retained.map((record) => record.runId)).size, 16);
  assert.equal(new Set(retained.map((record) => record.artifactId)).size, 16);
  assert.deepEqual(retained[0], {
    runId: '37677421103',
    sourceCommit: 'eacbc6b17c4434a66be087f52172fa6ae4101ebc',
    artifactId: 11507199447,
    expiresAt: '2027-01-05T19:49:42Z',
  });
});
