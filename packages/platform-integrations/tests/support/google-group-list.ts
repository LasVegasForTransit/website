import assert from 'node:assert/strict';
import { address, directory, groupEmail, groupId } from './google-directory';

export function listedUser(id: string, role = 'MEMBER') {
  return {
    kind: 'admin#directory#member',
    id,
    type: 'USER',
    role,
    email: `${id}@lasvegasfortransit.org`,
    status: 'ACTIVE',
    etag: 'member-fixture',
  };
}

export function groupList(pages: Record<string, unknown>[] = [{ members: [] }]) {
  const calls: URL[] = [];
  const state = { pages, groupId, groupEmail, failPage: -1 };
  const tokens = directory().tokens;
  const fetcher: typeof fetch = (input, init = {}) => {
    const url = new URL(address(input));
    calls.push(url);
    assert.equal(url.origin, 'https://admin.googleapis.com');
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'manual');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer synthetic-access-token');
    const path = decodeURIComponent(url.pathname.replace('/admin/directory/v1', ''));
    if (path === `/groups/${groupEmail}`)
      return Promise.resolve(
        Response.json({
          kind: 'admin#directory#group',
          id: state.groupId,
          email: state.groupEmail,
        }),
      );
    assert.equal(path, `/groups/${state.groupId}/members`);
    assert.equal(url.searchParams.get('includeDerivedMembership'), 'true');
    assert.equal(url.searchParams.get('maxResults'), '200');
    assert.equal(url.searchParams.has('roles'), false);
    const token = url.searchParams.get('pageToken');
    const page = token ? Number(token.replace('opaque+/=?', '')) : 0;
    if (state.failPage === page)
      return Promise.resolve(Response.json({}, { status: 429, headers: { 'Retry-After': '30' } }));
    assert.ok(state.pages[page], 'unexpected page token');
    return Promise.resolve(
      Response.json({
        kind: 'admin#directory#members',
        etag: 'page-fixture',
        ...state.pages[page],
      }),
    );
  };
  return { state, calls, tokens, fetch: fetcher };
}
