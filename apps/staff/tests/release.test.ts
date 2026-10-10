import assert from 'node:assert/strict';
import { readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { packageStaffRelease, verifyStaffRelease } from '../scripts/release-artifact';
import { releaseFixture, releaseIdentity } from './support/release';

void test('staff and jobs retain the same reviewed bytes, isolated configs and canonical migrations', async () => {
  const f = await releaseFixture();
  try {
    const release = await packageStaffRelease(f.source, f.destination, releaseIdentity);
    await writeFile(join(f.source, 'apps/jobs/dist/index.js'), 'later build');
    assert.deepEqual(await verifyStaffRelease(f.destination, releaseIdentity), release);
    assert.equal(release.migrations.length, 2);
    assert.equal(release.commit, releaseIdentity.commit);
    assert.equal(
      release.files.some(([name]) => name.endsWith('.map')),
      false,
    );
    assert.equal(JSON.stringify(release).includes('/private/build/path'), false);
    const configs: Record<string, Record<string, unknown>> = {};
    for (const environment of ['preview', 'production']) {
      for (const app of ['staff', 'jobs']) {
        const name = `${app}/wrangler.${environment}.json`;
        const config = JSON.parse(await readFile(join(f.destination, name), 'utf8')) as Record<
          string,
          unknown
        >;
        configs[`${app}.${environment}`] = config;
        assert.equal(config.workers_dev, false);
        assert.equal(config.preview_urls, false);
        assert.equal(config.no_bundle, true);
        const db = (config.d1_databases as Record<string, unknown>[])[0];
        assert.equal(db.migrations_dir, '../migrations');
        assert.equal(
          db.database_name,
          environment === 'preview' ? 'lvbt-platform-preview' : 'lvbt-platform',
        );
      }
      const staff = configs[`staff.${environment}`];
      assert.equal((staff.assets as Record<string, unknown>).run_worker_first, true);
      assert.deepEqual(staff.routes, [
        {
          pattern: `staff${environment === 'preview' ? '-preview' : ''}.lasvegasfortransit.org`,
          custom_domain: true,
        },
      ]);
      assert.equal(configs[`jobs.${environment}`].routes, undefined);
    }
    assert.equal(
      await readFile(join(f.destination, 'jobs/worker/index.js'), 'utf8'),
      'export default { scheduled() {} };',
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

for (const mutation of [
  'staff',
  'jobs',
  'migration',
  'config',
  'added',
  'removed',
  'identity',
  'symlink',
]) {
  void test(`saved release rejects ${mutation} tampering`, async () => {
    const f = await releaseFixture();
    try {
      await packageStaffRelease(f.source, f.destination, releaseIdentity);
      const worker = join(f.destination, 'jobs/worker/index.js');
      if (mutation === 'staff')
        await writeFile(join(f.destination, 'staff/worker/chunks/page.mjs'), 'changed');
      if (mutation === 'jobs') await writeFile(worker, 'changed');
      if (mutation === 'migration')
        await writeFile(join(f.destination, 'migrations/0001_people.sql'), 'DROP TABLE people;');
      if (mutation === 'config')
        await writeFile(join(f.destination, 'staff/wrangler.preview.json'), '{}');
      if (mutation === 'added')
        await writeFile(join(f.destination, '.dev.vars'), 'PRIVATE=never-package');
      if (mutation === 'removed') await rm(worker);
      if (mutation === 'symlink') {
        await rm(worker);
        await symlink(join(f.source, 'apps/jobs/dist/index.js'), worker);
      }
      if (mutation === 'identity') {
        const manifest = JSON.parse(
          await readFile(join(f.destination, 'release.json'), 'utf8'),
        ) as Record<string, unknown>;
        await writeFile(
          join(f.destination, 'release.json'),
          JSON.stringify({ ...manifest, commit: 'b'.repeat(40) }),
        );
      }
      await assert.rejects(verifyStaffRelease(f.destination, releaseIdentity));
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
}

void test('verification rejects the wrong selected release and packaging rejects reused destinations', async () => {
  const f = await releaseFixture();
  try {
    await packageStaffRelease(f.source, f.destination, releaseIdentity);
    await assert.rejects(
      verifyStaffRelease(f.destination, { ...releaseIdentity, releaseId: '999' }),
    );
    await assert.rejects(packageStaffRelease(f.source, f.destination, releaseIdentity));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('source symlinks and missing migration payloads cannot become release content', async () => {
  const f = await releaseFixture();
  try {
    const chunk = join(f.source, 'apps/staff/dist/server/chunks/page.mjs');
    await rm(chunk);
    await symlink(join(f.source, 'apps/jobs/dist/index.js'), chunk);
    await assert.rejects(
      packageStaffRelease(f.source, f.destination, releaseIdentity),
      /symbolic/i,
    );
    await rm(chunk);
    await writeFile(chunk, 'export {};');
    await rm(join(f.source, 'packages/platform-storage/migrations'), { recursive: true });
    await assert.rejects(packageStaffRelease(f.source, f.destination, releaseIdentity));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('release variables reject credentials and unknown bindings before any serialization', async () => {
  const f = await releaseFixture();
  try {
    const filename = join(f.source, 'apps/staff/wrangler.jsonc');
    const original = await readFile(filename, 'utf8');
    for (const name of ['LVBT_RESEND_API_KEY', 'LVBT_SIGN_IN_SECRET', 'NEW_PROVIDER_CREDENTIAL']) {
      await writeFile(
        filename,
        original.replace('"vars": {', `"vars": {"${name}":"DO-NOT-DISCLOSE",`),
      );
      await assert.rejects(
        packageStaffRelease(f.source, f.destination, releaseIdentity),
        /public variables/i,
      );
    }
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
