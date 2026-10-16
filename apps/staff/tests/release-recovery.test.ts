import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { zipSync } from 'fflate';
import { prepareStaffReceipt } from '../scripts/release-recovery';
import { newReceipt } from '../scripts/release-receipt';
import { packageStaffRelease } from '../scripts/release-artifact';
import { digest } from '../scripts/release-files';
import { releaseFixture, releaseIdentity } from './support/release';

async function fixture() {
  const f = await releaseFixture();
  const release = await packageStaffRelease(f.source, f.destination, releaseIdentity);
  const receipt = newReceipt(release, 'lvbt-account', 'preview', 'setup');
  receipt.formatVersion = 1; // Retained preview receipts remain recoverable without schedule writes.
  receipt.status = 'failed';
  receipt.workers = (['staff', 'jobs'] as const).map((app, index) => ({
    app,
    name: `lvbt-${app}-preview`,
    active: false,
    versionId: `${index + 1}1111111-1111-4111-8111-111111111111`,
    previousVersions: [{ versionId: '99999999-9999-4999-8999-999999999999', percentage: 100 }],
  }));
  const repository = 'LasVegasForTransit/website';
  const run = {
    id: 67890,
    run_attempt: 1,
    name: 'Deploy staff preview',
    path: '.github/workflows/deploy-staff-preview.yml',
    event: 'workflow_dispatch',
    head_branch: 'main',
    head_sha: 'b'.repeat(40),
    status: 'completed',
    conclusion: 'failure',
    repository: { id: 77, full_name: repository },
    head_repository: { id: 77, full_name: repository },
  };
  const artifact = {
    id: 99,
    name: 'staff-preview-deployment-67890',
    expired: false,
    digest: '',
    size_in_bytes: 0,
    workflow_run: {
      id: run.id,
      repository_id: 77,
      head_repository_id: 77,
      head_branch: 'main',
      head_sha: run.head_sha,
    },
  };
  let archive: Uint8Array;
  function archiveFor(
    files: Record<string, Uint8Array> = {
      'staff-deployment.json': new TextEncoder().encode(JSON.stringify(receipt)),
    },
  ) {
    archive = zipSync(files);
    artifact.digest = `sha256:${digest(archive)}`;
    artifact.size_in_bytes = archive.length;
  }
  archiveFor();
  const client = {
    run: () => Promise.resolve(run),
    artifacts: () => Promise.resolve([artifact]),
    download: () => Promise.resolve(archive),
  };
  const filename = join(f.root, 'recovered.json');
  const options = {
    repository,
    runId: '67890',
    filename,
    release,
    accountId: 'lvbt-account',
    stage: 'setup' as const,
  };
  return { ...f, options, receipt, run, artifact, client, archiveFor };
}

void test('retained deployment retrieval preserves the original build and uploaded versions', async () => {
  const f = await fixture();
  try {
    await prepareStaffReceipt(f.options, f.client);
    assert.deepEqual(JSON.parse(await readFile(f.options.filename, 'utf8')), f.receipt);
    await writeFile(f.options.filename, 'existing private receipt');
    await assert.rejects(prepareStaffReceipt(f.options, f.client));
    assert.equal(await readFile(f.options.filename, 'utf8'), 'existing private receipt');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('foreign or unfinished deployments and tampered artifact provenance cannot supply a receipt', async () => {
  const f = await fixture();
  try {
    const original = structuredClone(f.run);
    for (const change of [
      { head_branch: 'feature' },
      { status: 'in_progress' },
      { event: 'pull_request' },
      { path: '.github/workflows/other.yml' },
      { head_repository: { id: 78, full_name: f.options.repository } },
    ]) {
      Object.assign(f.run, original, change);
      await assert.rejects(prepareStaffReceipt(f.options, f.client));
    }
    Object.assign(f.run, original);
    for (const change of [
      { expired: true },
      { digest: `sha256:${'0'.repeat(64)}` },
      { workflow_run: { ...f.artifact.workflow_run, head_sha: 'c'.repeat(40) } },
    ]) {
      const baseline = structuredClone(f.artifact);
      Object.assign(f.artifact, change);
      await assert.rejects(prepareStaffReceipt(f.options, f.client));
      Object.assign(f.artifact, baseline);
    }
    await assert.rejects(readFile(f.options.filename));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('partial, cross-account, cross-stage and malformed receipts never reach activation or leak content', async () => {
  const f = await fixture();
  try {
    const baseline = structuredClone(f.receipt);
    for (const change of [
      { workers: f.receipt.workers.slice(0, 1) },
      { accountId: 'other-account' },
      { stage: 'launch' },
      { commit: 'c'.repeat(40) },
      { artifactHash: '0'.repeat(64) },
    ]) {
      Object.assign(f.receipt, baseline, change);
      f.archiveFor();
      await assert.rejects(prepareStaffReceipt(f.options, f.client));
      await assert.rejects(readFile(f.options.filename));
    }
    const invalidArchives: Record<string, Uint8Array>[] = [
      { 'staff-deployment.json': new TextEncoder().encode('DO-NOT-DISCLOSE-CONTENT') },
      { '../staff-deployment.json': new Uint8Array(1) },
      { 'staff-deployment.json': new Uint8Array(65 * 1024) },
    ];
    for (const files of invalidArchives) {
      f.archiveFor(files);
      await assert.rejects(
        prepareStaffReceipt(f.options, f.client),
        (error: unknown) => !String(error).includes('DO-NOT-DISCLOSE'),
      );
      await assert.rejects(readFile(f.options.filename));
    }
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('production receipt recovery requires its own workflow provenance and environment', async () => {
  const f = await fixture();
  try {
    f.run.name = 'Deploy staff production';
    f.run.path = '.github/workflows/deploy-staff-production.yml';
    f.artifact.name = 'staff-production-deployment-67890';
    f.receipt.environment = 'production';
    f.receipt.stage = 'launch';
    f.receipt.formatVersion = 2;
    f.receipt.schedule = { previous: [], desired: ['* * * * *'], state: 'attempted' };
    for (const worker of f.receipt.workers) worker.name = worker.name.replace('-preview', '');
    f.archiveFor();
    await assert.rejects(prepareStaffReceipt(f.options, f.client));
    await prepareStaffReceipt(
      { ...f.options, environment: 'production', stage: 'launch' },
      f.client,
    );
    assert.deepEqual(JSON.parse(await readFile(f.options.filename, 'utf8')), f.receipt);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
