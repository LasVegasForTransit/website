import assert from 'node:assert/strict';
import test from 'node:test';
import { portableBuildSource } from '../scripts/portable-build';

void test('compiled Astro filenames and manifest URLs contain portable build paths', () => {
  const root = new URL('file:///Users/private%20user/checkout/');
  const source =
    'const file = "/Users/private user/checkout/apps/staff/src/pages/index.astro"; const rootDir = "file:///Users/private%20user/checkout/apps/staff/"; import "./chunks/page.mjs";';
  const result = portableBuildSource(source, root);
  assert.equal(result.includes('private'), false);
  assert.match(result, /\/lvbt\/source\/apps\/staff\/src\/pages\/index\.astro/);
  assert.match(result, /file:\/\/\/lvbt\/source\/apps\/staff/);
  assert.match(result, /import "\.\/chunks\/page\.mjs"/);
  assert.equal(portableBuildSource('export default {};', root), 'export default {};');
});
