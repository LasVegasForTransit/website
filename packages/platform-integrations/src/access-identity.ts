import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import { WORKSPACE_DOMAIN } from '@lasvegasfortransit/platform-core/workspace-identity';
export interface AccessEnv {
  LVBT_ACCESS_TEAM_DOMAIN?: string;
  LVBT_ACCESS_AUD?: string;
}
export interface AccessIdentity {
  email: string;
  subject: string;
}
const resolvers = new WeakMap<typeof fetch, Map<string, ReturnType<typeof createRemoteJWKSet>>>();
function accessKeys(issuer: string, fetcher: typeof fetch) {
  let byIssuer = resolvers.get(fetcher);
  if (!byIssuer) {
    byIssuer = new Map();
    resolvers.set(fetcher, byIssuer);
  }
  let resolver = byIssuer.get(issuer);
  if (!resolver) {
    resolver = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {
      [customFetch]: (url, options) => fetcher(url, options),
      timeoutDuration: 5000,
      cacheMaxAge: 60 * 60 * 1000,
      cooldownDuration: 30_000,
    });
    byIssuer.set(issuer, resolver);
  }
  return resolver;
}
export async function verifyAccessAssertion(
  request: Request,
  env: AccessEnv,
  options: { now?: Date; fetch?: typeof fetch } = {},
): Promise<AccessIdentity | null> {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (
    !token ||
    token.length > 16_384 ||
    !env.LVBT_ACCESS_AUD ||
    !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.LVBT_ACCESS_TEAM_DOMAIN ?? '')
  )
    return null;
  const issuer = `https://${env.LVBT_ACCESS_TEAM_DOMAIN}`;
  try {
    const { payload } = await jwtVerify(token, accessKeys(issuer, options.fetch ?? fetch), {
      issuer,
      audience: env.LVBT_ACCESS_AUD,
      algorithms: ['RS256'],
      requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat', 'email'],
      currentDate: options.now ?? new Date(),
    });
    if (
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      typeof payload.email !== 'string' ||
      !payload.email.toLowerCase().endsWith(`@${WORKSPACE_DOMAIN}`) ||
      payload.type !== 'app'
    )
      return null;
    return { subject: payload.sub, email: payload.email.toLowerCase() };
  } catch {
    return null;
  }
}
