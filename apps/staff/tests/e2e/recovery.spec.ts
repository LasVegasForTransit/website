import assert from 'node:assert/strict';
import { ORIGIN, startRuntime } from '../support/runtime';
const fixture = await startRuntime();
try {
  const headers = {
    'Cf-Access-Jwt-Assertion': fixture.admin.assertion,
    Cookie: `__Host-lvbt_session=${fixture.admin.session.token}`,
  };
  const request = async (path: string, authenticated = true) =>
    fixture.simulator.dispatchFetch(`${ORIGIN}${path}`, {
      headers: authenticated ? headers : {},
      redirect: 'manual',
    });
  for (const [path, authenticated, expected] of [
    ['/people/', false, 403],
    ['/not-a-staff-route/', true, 404],
  ] as const) {
    const response = await request(path, authenticated);
    const html = await response.text();
    assert.equal(response.status, expected);
    assert.match(html, /<main/);
    assert.match(html, /Las Vegans for Better Transit/);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  }
  await fixture.db.prepare('ALTER TABLE sessions RENAME TO unavailable_session_fixture').run();
  const response = await request('/people/');
  const html = await response.text();
  assert.equal(response.status, 503);
  assert.match(html, /We’re having trouble with staff tools/);
  assert.doesNotMatch(
    html.replace(/<style>[\s\S]*?<\/style>/g, ''),
    /D1_ERROR|no such table|unavailable_session_fixture|SQLITE/,
  );
  assert.match(response.headers.get('Content-Security-Policy') ?? '', /font-src 'self' data:/);
  console.log(
    'Compiled staff gateway: protected refusal, missing page and database failure preserve branded private responses.',
  );
} finally {
  await fixture.dispose();
}
