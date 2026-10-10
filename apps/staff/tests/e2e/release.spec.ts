import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { packageStaffRelease, verifyStaffRelease } from '../../scripts/release-artifact';

const { values } = parseArgs({
  options: {
    directory: { type: 'string' },
    commit: { type: 'string' },
    'release-id': { type: 'string' },
  },
});
if (values.directory && (!values.commit || !values['release-id']))
  throw new Error('A saved artifact requires its selected commit and Actions run ID.');
// The default fixture has synthetic identity and cannot prove Actions provenance.
const identity = {
  commit: values.commit ?? '0'.repeat(40),
  releaseId: values['release-id'] ?? '1',
};
const source = fileURLToPath(new URL('../../../../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'lvbt-staff-artifact-runtime-'));
let runtime: Miniflare | undefined;
try {
  const directory = values.directory ?? join(temporary, 'release');
  const release = values.directory
    ? await verifyStaffRelease(directory, identity)
    : await packageStaffRelease(source, directory, identity);
  for (const [name] of release.files.filter(([name]) => /\.(mjs|js|json)$/.test(name))) {
    const content = await readFile(join(directory, name), 'utf8');
    assert.equal(
      content.includes(source.replace(/\/$/, '')),
      false,
      `Non-portable build path in ${name}`,
    );
  }
  const server = join(directory, 'staff/worker');
  const chunks = (await readdir(server, { recursive: true })).filter(
    (name) => name.endsWith('.mjs') && name !== 'entry.mjs',
  );
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      name: 'lvbt-saved-staff-fixture',
      modules: ['entry.mjs', ...chunks].map((name) => ({
        type: 'ESModule' as const,
        path: join(server, name),
      })),
      modulesRoot: server,
      compatibilityDate: '2026-09-04',
      compatibilityFlags: ['nodejs_compat'],
      cf: false,
      telemetry: { enabled: false },
      assets: {
        directory: join(directory, 'staff/assets'),
        binding: 'ASSETS',
        run_worker_first: true,
        routerConfig: { has_user_worker: true },
      },
    }),
  );
  for (const origin of [
    'https://staff.lasvegasfortransit.org',
    'https://unapproved.example.invalid',
  ]) {
    for (const path of ['/', '/fonts/public-sans-latin.woff2', '/unknown']) {
      const response = await runtime.dispatchFetch(`${origin}${path}`);
      assert.equal(response.status, 403);
      assert.match(response.headers.get('Cache-Control') ?? '', /no-store/);
      assert.match(response.headers.get('X-Robots-Tag') ?? '', /noindex/);
    }
  }
  assert.deepEqual(await verifyStaffRelease(directory, identity), release);
  process.stdout.write(
    `Saved compiled artifact: ${release.files.length} files, ${release.migrations.length} migrations; protected routes/assets passed.\n`,
  );
} finally {
  await runtime?.dispose();
  await rm(temporary, { recursive: true, force: true });
}
