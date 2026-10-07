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

void test('production promotion resolves a selected immutable release and never rebuilds', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /run_id:/);
  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.match(workflow, /pnpm worker:release source/);
  assert.match(workflow, /run-id: \$\{\{ needs.source.outputs.release-id \}\}/);
  assert.match(workflow, /pnpm worker:release verify/);
  assert.match(workflow, /pnpm worker:release upload/);
  assert.match(workflow, /pnpm worker:release activate/);
  assert.match(workflow, /pnpm worker:test:browser/);
  assert.doesNotMatch(workflow, /pnpm build|pnpm check\s|wrangler deploy|worker:deploy/);
});

void test('Worker builds use the production analytics contract', async () => {
  const workflows = await Promise.all(
    [
      new URL('../../../.github/workflows/deploy-production.yml', import.meta.url),
      previewWorkflowUrl,
    ].map((url) => readFile(url, 'utf8')),
  );

  for (const workflow of workflows) {
    assert.match(workflow, /PUBLIC_LVBT_CWA_TOKEN: \$\{\{ vars\.PUBLIC_LVBT_CWA_TOKEN \}\}/);
    assert.match(workflow, /LVBT_REQUIRE_ANALYTICS: '1'/);
  }
});

void test('main deploys staging, stores hidden compiled files and never activates production', async () => {
  const workflow = await readFile(
    new URL('../../../.github/workflows/deploy-production.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /name: Deploy staging/);
  assert.match(workflow, /include-hidden-files: true/);
  assert.match(workflow, /worker:release package/);
  assert.match(workflow, /worker:release activate --target preview/);
  assert.doesNotMatch(workflow, /--target production|deploy-cloudflare-pages/);
});
