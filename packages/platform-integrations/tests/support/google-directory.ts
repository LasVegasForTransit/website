import assert from 'node:assert/strict';

export const userId = '123456789012345678901';
export const userEmail = 'rider@lasvegasfortransit.org';
export const groupEmail = 'preview-advocacy@lasvegasfortransit.org';
export const groupId = 'group-advocacy';
export const configuration = {
  environment: 'preview' as const,
  customerId: 'Cfixture',
  managedGroups: [groupEmail],
  productionGroups: ['advocacy@lasvegasfortransit.org'],
};
export const reconciliation = {
  identityId: userId,
  identityEmail: userEmail,
  groupEmail,
  desired: true,
  operationId: 'committee-fixture',
  isCurrent: () => Promise.resolve(true),
};
export function notFound() {
  return Response.json(
    { error: { code: 404, errors: [{ domain: 'global', reason: 'notFound' }] } },
    { status: 404 },
  );
}
export function address(input: Parameters<typeof fetch>[0]): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
export function directory() {
  const state = {
    user: {
      kind: 'admin#directory#user',
      id: userId,
      primaryEmail: userEmail,
      customerId: 'Cfixture',
      suspended: false,
      archived: false,
    },
    group: { kind: 'admin#directory#group', id: groupId, email: groupEmail },
    direct: false,
    inherited: false,
    role: 'MEMBER',
    memberId: userId,
    applyWrites: true,
  };
  const calls: { path: string; method: string; body: unknown }[] = [];
  const member = () => ({
    kind: 'admin#directory#member',
    id: state.memberId,
    email: state.user.primaryEmail,
    role: state.role,
    type: 'USER',
    status: 'ACTIVE',
    delivery_settings: 'ALL_MAIL',
  });
  function read(path: string): Response {
    if (path === `/users/${userId}`) return Response.json(state.user);
    if (path === `/groups/${groupEmail}`) return Response.json(state.group);
    if (path === `/groups/${groupId}/members/${userId}`)
      return state.direct ? Response.json(member()) : notFound();
    if (path === `/groups/${groupId}/hasMember/${userId}`)
      return Response.json({ isMember: state.direct || state.inherited });
    throw new Error('Unexpected Directory read');
  }
  function write(path: string, method: string, body: unknown): Response {
    if (method === 'POST' && path === `/groups/${groupId}/members`) {
      assert.deepEqual(body, { email: userEmail, role: 'MEMBER' });
      if (state.applyWrites) state.direct = true;
      return Response.json(member());
    }
    if (method === 'DELETE' && path === `/groups/${groupId}/members/${userId}`) {
      if (state.applyWrites) state.direct = false;
      return new Response(null, { status: 204 });
    }
    throw new Error('Unexpected Directory request');
  }
  const fetcher: typeof fetch = (input, init = {}) => {
    const url = new URL(address(input));
    assert.equal(url.origin, 'https://admin.googleapis.com');
    assert.equal(init.redirect, 'manual');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer synthetic-access-token');
    const path = decodeURIComponent(url.pathname.replace('/admin/directory/v1', ''));
    const method = init.method ?? 'GET';
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ path, method, body });
    return Promise.resolve(method === 'GET' ? read(path) : write(path, method, body));
  };
  const tokens = {
    getToken: (scopes: readonly string[]) => {
      assert.deepEqual([...scopes].sort(), [
        'https://www.googleapis.com/auth/admin.directory.group.member',
        'https://www.googleapis.com/auth/admin.directory.group.readonly',
        'https://www.googleapis.com/auth/admin.directory.user.readonly',
      ]);
      return Promise.resolve('synthetic-access-token');
    },
  };
  return { state, calls, fetch: fetcher, tokens, member };
}
