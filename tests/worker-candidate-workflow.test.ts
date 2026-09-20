import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const workflowUrl = new URL('../.github/workflows/deploy-worker-candidate.yml', import.meta.url);
const previewWorkflowUrl = new URL(
  '../.github/workflows/deploy-worker-preview.yml',
  import.meta.url,
);

void test('Worker candidates remain parallel to Pages production', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');

  assert.match(workflow, /workflows: \[Deploy production\]/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /CLOUDFLARE_WORKERS_CANDIDATE_ENABLED == 'true'/);
  assert.match(workflow, /pnpm worker:preview/);
  assert.match(workflow, /pnpm worker:test:live/);
  assert.match(workflow, /pnpm worker:test:browser/);
  assert.doesNotMatch(workflow, /wrangler deploy/);
  assert.doesNotMatch(workflow, /worker:deploy/);
});

void test('Worker builds use the production analytics contract', async () => {
  const workflows = await Promise.all(
    [workflowUrl, previewWorkflowUrl].map((url) => readFile(url, 'utf8')),
  );

  for (const workflow of workflows) {
    assert.match(workflow, /PUBLIC_LVBT_CWA_TOKEN: \$\{\{ vars\.PUBLIC_LVBT_CWA_TOKEN \}\}/);
    assert.match(workflow, /LVBT_REQUIRE_ANALYTICS: '1'/);
  }
});
