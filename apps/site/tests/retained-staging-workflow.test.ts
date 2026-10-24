import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

async function workflow(name: string): Promise<string> {
  return await readFile(new URL(`../../../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
}

function events(source: string): string[] {
  const block = /^on:\n([\s\S]*?)(?=^\S)/m.exec(source)?.[1];
  assert.ok(block, 'Workflow must declare its events.');
  return [...block.matchAll(/^ {2}([a-z_]+):/gm)].map((match) => {
    assert.ok(match[1]);
    return match[1];
  });
}

void test('retained staging requires dispatch instead of deploying every main push', async () => {
  assert.deepEqual(events(await workflow('deploy-production')), ['workflow_dispatch']);
});

void test('manual retained staging preserves artifact verification and publication gates', async () => {
  const source = await workflow('deploy-production');
  assert.match(source, /group: website-staging\n {2}cancel-in-progress: false/);
  assert.match(source, /release-build\.yml@94842f40fa6d912249860b34a61d314adcaa19b6/);
  assert.match(source, /artifact-source: typed-worker/);
  assert.match(source, /require-analytics: true/);
  assert.match(source, /artifact-validation:\n[\s\S]*?needs: build/);
  assert.match(source, /uses: \.\/\.github\/actions\/validate-retained-ui/);
  assert.match(source, /attest:\n[\s\S]*?needs: \[build, artifact-validation\]/);
  assert.match(source, /release-attest\.yml@3567f0cb1345e8756eb5d84e0a3ea7b62695125a/);
  assert.match(source, /staging:\n[\s\S]*?needs: \[build, attest\]/);
  assert.match(source, /if: github.ref == 'refs\/heads\/main'/);
  // Keep the reviewed publisher, including retained migrations and version readiness.
  assert.match(source, /release-publish\.yml@e788db94b39634f0e844284efdac9d3db95923a0/);
  assert.match(source, /target: preview/);
  assert.match(source, /attestation-prefix: attestation-website-release/);
  assert.match(source, /smoke-script: worker:smoke/);
  assert.match(source, /browser-project: hosted-acceptance/);
});

void test('source checks, production controls and calendar dispatch remain separate', async () => {
  assert.ok(events(await workflow('ci')).includes('pull_request'));
  assert.ok(events(await workflow('audit')).includes('push'));
  assert.ok(events(await workflow('audit')).includes('pull_request'));
  assert.ok(events(await workflow('build-staff-release')).includes('push'));
  assert.deepEqual(events(await workflow('deploy-worker-candidate')), ['workflow_dispatch']);
  assert.deepEqual(events(await workflow('deploy-staff-production')), ['workflow_dispatch']);
  const calendar = await workflow('cron-rebuild');
  assert.ok(events(calendar).includes('schedule'));
  assert.match(calendar, /gh workflow run deploy-production\.yml --ref main/);
});
