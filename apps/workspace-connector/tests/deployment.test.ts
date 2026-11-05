import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentPlan, type DeploymentConfig } from '../src/deployment';
import { config } from './support/runtime';
const input: DeploymentConfig = {
  project: 'lvbt-core',
  region: 'us-central1',
  service: 'lvbt-workspace-preview',
  image: `us-central1-docker.pkg.dev/lvbt-core/workspace-connectors/lvbt-workspace-preview@sha256:${'a'.repeat(64)}`,
  runtimeSubject: '111111111111111111111',
  schedulerAccount: 'lvbt-workspace-tick-preview@lvbt-core.iam.gserviceaccount.com',
  connector: {
    ...config,
    serviceAccount: 'lvbt-workspace-preview@lvbt-core.iam.gserviceaccount.com',
  },
};
void test('deployment plans pin identities, preserve disabled rollout and emit reviewable argument arrays', () => {
  const plan = deploymentPlan(input);
  assert.equal(plan.cloudflare.LVBT_WORKSPACE_ONBOARDING_ENABLED, 'false');
  for (const cmd of plan.commands) {
    assert.ok(cmd.includes('--account=willie@lasvegasfortransit.org'));
    assert.ok(cmd.includes('--project=lvbt-core'));
  }
  assert.ok(plan.commands.flat().includes('--max-instances=1'));
  assert.ok(plan.commands.flat().includes('--min-instances=0'));
  assert.ok(!JSON.stringify(plan).includes('roles/owner'));
});
void test('mutable images, shared identities, production groups and wrong projects cannot be planned', () => {
  for (const value of [
    { ...input, image: input.image.replace(/@.*/, ':latest') },
    { ...input, project: 'other' },
    { ...input, runtimeSubject: config.schedulerSubject },
    { ...input, schedulerAccount: 'lvbt-workspace-tick@lvbt-core.iam.gserviceaccount.com' },
    {
      ...input,
      connector: { ...input.connector, consoleGroupEmail: config.productionConsoleGroupEmail },
    },
  ])
    assert.throws(() => deploymentPlan(value));
});
