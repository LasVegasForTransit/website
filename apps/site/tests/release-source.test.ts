import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseSource } from '../scripts/deploy/release-source';

const run = {
  id: 123,
  run_attempt: 1,
  name: 'Deploy staging',
  path: '.github/workflows/deploy-production.yml',
  event: 'push',
  head_branch: 'main',
  head_sha: 'a'.repeat(40),
  status: 'completed',
  conclusion: 'success',
  repository: { full_name: 'LasVegasForTransit/website' },
  head_repository: { full_name: 'LasVegasForTransit/website' },
};
void test('promotion selects the immutable successful main staging run', () => {
  assert.deepEqual(releaseSource(run, 'LasVegasForTransit/website', '123'), {
    commit: 'a'.repeat(40),
    releaseId: '123',
  });
});

void test('retrying a failed staging job preserves the previously saved release identity', () => {
  assert.deepEqual(releaseSource({ ...run, run_attempt: 2 }, 'LasVegasForTransit/website', '123'), {
    commit: 'a'.repeat(40),
    releaseId: '123',
  });
});
for (const mutation of [
  { event: 'pull_request' },
  { head_branch: 'feature' },
  { status: 'in_progress' },
  { conclusion: 'failure' },
  { path: '.github/workflows/deploy-worker-preview.yml' },
  { name: 'Deploy production' },
  { id: 124 },
  { head_repository: { full_name: 'outsider/website' } },
]) {
  void test(`promotion rejects ${JSON.stringify(mutation)}`, () =>
    assert.throws(() =>
      releaseSource({ ...run, ...mutation }, 'LasVegasForTransit/website', '123'),
    ));
}
