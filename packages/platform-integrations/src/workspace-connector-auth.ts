import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
const resolvers = new WeakMap<typeof fetch, ReturnType<typeof createRemoteJWKSet>>();
function keys(fetcher: typeof fetch) {
  let resolver = resolvers.get(fetcher);
  if (!resolver) {
    resolver = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), {
      [customFetch]: (url, options) => fetcher(url, options),
      timeoutDuration: 5000,
      cacheMaxAge: 3600000,
      cooldownDuration: 30000,
    });
    resolvers.set(fetcher, resolver);
  }
  return resolver;
}
export async function verifyWorkspaceWorkload(
  request: Request,
  identity: { subject: string; audience: string },
  options: { fetch?: typeof fetch; now?: Date } = {},
) {
  const authorization = request.headers.get('Authorization');
  if (
    !authorization?.startsWith('Bearer ') ||
    authorization.length > 16384 ||
    !identity.subject ||
    !identity.audience
  )
    return false;
  try {
    const { payload } = await jwtVerify(authorization.slice(7), keys(options.fetch ?? fetch), {
      issuer: 'https://accounts.google.com',
      subject: identity.subject,
      audience: identity.audience,
      algorithms: ['RS256'],
      requiredClaims: ['iss', 'sub', 'aud', 'iat', 'exp'],
      maxTokenAge: '1h',
      currentDate: options.now ?? new Date(),
    });
    return payload.aud === identity.audience;
  } catch {
    return false;
  }
}
