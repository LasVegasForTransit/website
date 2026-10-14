import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  uploadStaffRelease,
  activateStaffRelease,
  inspectStaffRelease,
} from '../scripts/release-deploy';
import { verifyStaffRelease } from '../scripts/release-artifact';
import { deploymentFixture, versions } from './support/deployment';
import { releaseIdentity } from './support/release';

void test('saved deployment inspection reports readiness without changing receipt or traffic', async () => {
  const f = await deploymentFixture();
  try {
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    const before = await readFile(f.receiptFile, 'utf8');
    const result = await inspectStaffRelease(
      f.destination,
      releaseIdentity,
      f.receiptFile,
      f.options,
    );
    assert.equal(Reflect.get(result, 'ready'), true);
    assert.equal(await readFile(f.receiptFile, 'utf8'), before);
    assert.equal(f.state.commands.length, 2);
    f.state.wrongVersion = true;
    const blocked = await inspectStaffRelease(
      f.destination,
      releaseIdentity,
      f.receiptFile,
      f.options,
    );
    assert.equal(Reflect.get(blocked, 'ready'), false);
    assert.ok(JSON.stringify(blocked).includes('staff.version'));
    assert.equal(JSON.stringify(blocked).includes('DO-NOT-PRINT'), false);
    assert.equal(await readFile(f.receiptFile, 'utf8'), before);
    assert.equal(f.state.commands.length, 2);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('activation failure identifies the failed Worker stage without disclosing provider output', async () => {
  const f = await deploymentFixture();
  try {
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    f.state.failActivateJobs = true;
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(Reflect.get(error, 'stage'), 'jobs.activation');
        assert.equal(String(error).includes('DO-NOT-PRINT'), false);
        return true;
      },
    );
    const receipt = JSON.parse(await readFile(f.receiptFile, 'utf8')) as {
      workers: { active: boolean }[];
    };
    assert.equal(receipt.workers[0].active, true);
    assert.equal(receipt.workers[1].active, false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('inspection refuses rollback to previous traffic after an acknowledged activation', async () => {
  const f = await deploymentFixture();
  try {
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    f.state.failActivateJobs = true;
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    const before = await readFile(f.receiptFile, 'utf8');
    const receipt = JSON.parse(before) as {
      workers: { previousVersions: { versionId: string; percentage: number }[] }[];
    };
    const result = await inspectStaffRelease(f.destination, releaseIdentity, f.receiptFile, {
      ...f.options,
      fetch: (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input);
        if (url.pathname.endsWith('/lvbt-staff-preview/deployments'))
          return Promise.resolve(
            Response.json({
              success: true,
              result: {
                deployments: [
                  {
                    id: 'baseline-deployment',
                    versions: receipt.workers[0].previousVersions.map((version) => ({
                      version_id: version.versionId,
                      percentage: version.percentage,
                    })),
                  },
                ],
              },
            }),
          );
        return f.options.fetch(input, init);
      },
    });
    assert.equal(result.ready, false);
    assert.ok(result.checks.some((check) => check.stage === 'staff.readback' && !check.passed));
    assert.equal(f.state.commands.length, 4);
    assert.equal(await readFile(f.receiptFile, 'utf8'), before);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('uploaded-version validation has a distinct failure stage before any activation', async () => {
  const f = await deploymentFixture();
  try {
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    f.state.wrongVersion = true;
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(Reflect.get(error, 'stage'), 'staff.version');
        return true;
      },
    );
    assert.equal(f.state.commands.length, 2);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('an unexpected active version blocks a pending activation even when its configuration matches', async () => {
  const f = await deploymentFixture();
  try {
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    f.state.failActivateJobs = true;
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    f.state.failActivateJobs = false;
    f.state.unexpectedJobsVersion = true;
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    assert.equal(f.state.commands.length, 4);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('a reviewed Discord configuration change can finish both activations and recover its recorded intermediate state', async () => {
  const f = await deploymentFixture(true);
  try {
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    f.state.failActivateJobs = true;
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    f.state.failActivateJobs = false;
    f.state.unexpectedJobsVersion = true;
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    assert.equal(f.state.commands.length, 4);
    f.state.unexpectedJobsVersion = false;
    const result = await activateStaffRelease(
      f.destination,
      releaseIdentity,
      f.receiptFile,
      f.options,
    );
    assert.equal(result.status, 'active');
    assert.ok(result.workers.every((worker) => worker.active));
    assert.equal(
      f.state.commands.filter(
        (args) => args[1] === 'deploy' && args[2] === `${versions.staff}@100%`,
      ).length,
      1,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('activation accepts the installed CLI serialized Map receipt only after exact provider readback', async () => {
  const f = await deploymentFixture();
  try {
    f.state.serializedMapTraffic = true;
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    const result = await activateStaffRelease(
      f.destination,
      releaseIdentity,
      f.receiptFile,
      f.options,
    );
    assert.equal(result.status, 'active');
    assert.ok(result.workers.every((worker) => worker.active && worker.deploymentId));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('an acknowledged activation with conflicting readback stops retries instead of overwriting a later deployment', async () => {
  const f = await deploymentFixture();
  try {
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    f.state.wrongJobsReadback = true;
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    const receipt = JSON.parse(await readFile(f.receiptFile, 'utf8')) as {
      workers: { active: boolean; deploymentId?: string }[];
    };
    assert.ok(receipt.workers[1].deploymentId);
    assert.equal(receipt.workers[1].active, false);
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    assert.equal(f.state.commands.length, 4);
    f.state.wrongJobsReadback = false;
    const resumed = await activateStaffRelease(
      f.destination,
      releaseIdentity,
      f.receiptFile,
      f.options,
    );
    assert.equal(resumed.status, 'active');
    assert.equal(f.state.commands.length, 4);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('saved files upload without rebuilding and activation uses actual recorded provider versions', async () => {
  const f = await deploymentFixture();
  try {
    await writeFile(join(f.source, 'apps/jobs/dist/index.js'), 'later unrelated build');
    const uploaded = await uploadStaffRelease(
      f.destination,
      releaseIdentity,
      f.receiptFile,
      f.options,
    );
    assert.equal(uploaded.status, 'uploaded');
    assert.deepEqual(
      uploaded.workers.map((worker) => worker.versionId),
      [versions.staff, versions.jobs],
    );
    assert.equal(f.state.commands.length, 2);
    assert.equal(JSON.stringify(uploaded).includes('DO-NOT-PRINT'), false);
    assert.equal(
      f.state.commands.some((args) => args[0] !== 'versions'),
      false,
    );
    const activated = await activateStaffRelease(
      f.destination,
      releaseIdentity,
      f.receiptFile,
      f.options,
    );
    assert.equal(activated.status, 'active');
    assert.equal(
      activated.workers.every((worker) => worker.active && worker.deploymentId),
      true,
    );
    assert.equal(f.state.commands.length, 4);
    await activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    assert.equal(f.state.commands.length, 4);
    assert.deepEqual(await verifyStaffRelease(f.destination, releaseIdentity), f.release);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('unsafe readiness and tampered artifact or cross-environment receipts stop before provider writes', async () => {
  const f = await deploymentFixture();
  try {
    f.state.unsafe = true;
    await assert.rejects(
      uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    assert.equal(f.state.commands.length, 0);
    f.state.unsafe = false;
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    const baseline = await readFile(f.receiptFile, 'utf8');
    for (const mutation of [
      { environment: 'production' },
      { accountId: 'other-account' },
      { artifactHash: '0'.repeat(64) },
      { commit: 'b'.repeat(40) },
    ]) {
      await writeFile(
        f.receiptFile,
        JSON.stringify({ ...(JSON.parse(baseline) as object), ...mutation }),
      );
      await assert.rejects(
        activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
      );
      assert.equal(f.state.commands.length, 2);
    }
    await writeFile(f.receiptFile, baseline);
    await writeFile(join(f.destination, 'jobs/worker/index.js'), 'tampered');
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    assert.equal(f.state.commands.length, 2);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('partial upload keeps its real version receipt and never leaks provider output or overwrites it', async () => {
  const f = await deploymentFixture();
  try {
    f.state.failUploadJobs = true;
    await assert.rejects(
      uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
      (error: unknown) => !String(error).includes('DO-NOT-PRINT'),
    );
    const receipt = JSON.parse(await readFile(f.receiptFile, 'utf8')) as {
      status: string;
      workers: { versionId: string }[];
    };
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.workers[0].versionId, versions.staff);
    assert.equal(receipt.workers.length, 1);
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    await assert.rejects(
      uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    assert.equal(f.state.commands.length, 2);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('provider version annotation mismatch is rejected before either recorded version activates', async () => {
  const f = await deploymentFixture();
  try {
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    f.state.wrongVersion = true;
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    assert.equal(f.state.commands.length, 2);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('partial activation is retained, resumes pending work and requires actual 100 percent readback', async () => {
  const f = await deploymentFixture();
  try {
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    f.state.failActivateJobs = true;
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    const receipt = JSON.parse(await readFile(f.receiptFile, 'utf8')) as {
      status: string;
      workers: { active: boolean }[];
    };
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.workers[0].active, true);
    f.state.failActivateJobs = false;
    f.state.wrongReadback = true;
    await assert.rejects(
      activateStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options),
    );
    f.state.wrongReadback = false;
    const result = await activateStaffRelease(
      f.destination,
      releaseIdentity,
      f.receiptFile,
      f.options,
    );
    assert.equal(result.status, 'active');
    assert.equal(
      f.state.commands.filter(
        (args) => args[1] === 'deploy' && args[2] === `${versions.staff}@100%`,
      ).length,
      1,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
