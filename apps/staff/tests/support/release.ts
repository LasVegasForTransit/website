import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const releaseIdentity = { commit: 'a'.repeat(40), releaseId: '12345' };
export async function releaseFixture() {
  const root = await mkdtemp(join(tmpdir(), 'lvbt-staff-release-test-'));
  const source = join(root, 'source');
  const destination = join(root, 'release');
  const files: Record<string, string> = {
    'apps/staff/dist/server/entry.mjs': 'import "./chunks/page.mjs"; export default {}',
    'apps/staff/dist/server/chunks/page.mjs': 'export const page = "staff";',
    'apps/staff/dist/server/wrangler.json': '{"configPath":"/private/build/path"}',
    'apps/staff/dist/client/fonts/font.woff2': 'synthetic font',
    'apps/staff/dist/client/.assetsignore': '_headers\n_redirects\n',
    'apps/jobs/dist/index.js': 'export default { scheduled() {} };',
    'apps/jobs/dist/index.js.map': '{"sources":["/private/build/path"]}',
    'packages/platform-storage/migrations/0001_people.sql': 'CREATE TABLE people(id TEXT);',
    'packages/platform-storage/migrations/0002_consent.sql': 'CREATE TABLE consent(id TEXT);',
  };
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(source, name, '..'), { recursive: true });
    await writeFile(join(source, name), content);
  }
  for (const app of ['site', 'staff', 'jobs']) {
    const config = await readFile(new URL(`../../../${app}/wrangler.jsonc`, import.meta.url));
    await mkdir(join(source, 'apps', app), { recursive: true });
    await writeFile(join(source, 'apps', app, 'wrangler.jsonc'), config);
  }
  return { root, source, destination };
}
