import { createRemoteJWKSet, customFetch, jwtVerify, type JWTPayload } from 'jose';
import {
  WORKSPACE_DOMAIN,
  type WorkspaceIdentity,
} from '@lasvegasfortransit/platform-core/workspace-identity';

const GOOGLE_KEYS = 'https://www.googleapis.com/oauth2/v3/certs';
const resolvers = new WeakMap<typeof fetch, ReturnType<typeof createRemoteJWKSet>>();

function googleKeys(fetcher: typeof fetch) {
  let resolver = resolvers.get(fetcher);
  if (!resolver) {
    resolver = createRemoteJWKSet(new URL(GOOGLE_KEYS), {
      [customFetch]: (url, options) => fetcher(url, options),
      timeoutDuration: 5000,
      cacheMaxAge: 60 * 60 * 1000,
      cooldownDuration: 30_000,
    });
    resolvers.set(fetcher, resolver);
  }
  return resolver;
}

function requireAuthorizedParty(payload: JWTPayload, clientId: string): void {
  if (
    (payload.azp !== undefined && payload.azp !== clientId) ||
    (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)
  )
    throw new Error('Google token is for another application');
}

function workspaceIdentity(payload: JWTPayload, nonce: string): WorkspaceIdentity {
  if (
    typeof payload.sub !== 'string' ||
    !payload.sub ||
    payload.hd !== WORKSPACE_DOMAIN ||
    payload.email_verified !== true ||
    typeof payload.email !== 'string' ||
    !payload.email.toLowerCase().endsWith(`@${WORKSPACE_DOMAIN}`) ||
    payload.nonce !== nonce
  )
    throw new Error('Google account is not an approved Workspace identity');
  return {
    subject: payload.sub,
    email: payload.email.toLowerCase(),
    givenName: typeof payload.given_name === 'string' ? payload.given_name : null,
    familyName: typeof payload.family_name === 'string' ? payload.family_name : null,
  };
}

export async function verifyGoogleIdToken(
  token: string,
  options: { clientId: string; nonce: string; now?: Date; fetch?: typeof fetch },
): Promise<WorkspaceIdentity> {
  if (!options.clientId || !options.nonce || token.length > 16_384) {
    throw new Error('Google sign-in is not valid');
  }
  const { payload } = await jwtVerify(token, googleKeys(options.fetch ?? fetch), {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: options.clientId,
    algorithms: ['RS256'],
    requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat'],
    currentDate: options.now ?? new Date(),
  });
  requireAuthorizedParty(payload, options.clientId);
  return workspaceIdentity(payload, options.nonce);
}

export async function exchangeGoogleCode(
  input: {
    code: string;
    verifier: string;
    callbackUrl: string;
    clientId: string;
    clientSecret: string;
  },
  fetcher: typeof fetch = fetch,
): Promise<string> {
  if (!input.code || input.code.length > 4096 || !input.clientId || !input.clientSecret) {
    throw new Error('Google sign-in exchange is unavailable');
  }
  const response = await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      code_verifier: input.verifier,
      redirect_uri: input.callbackUrl,
      client_id: input.clientId,
      client_secret: input.clientSecret,
    }),
  });
  if (!response.ok) throw new Error('Google sign-in exchange failed');
  const tokens: unknown = await response.json();
  if (
    !tokens ||
    typeof tokens !== 'object' ||
    !('id_token' in tokens) ||
    typeof tokens.id_token !== 'string'
  ) {
    throw new Error('Google sign-in did not return an identity');
  }
  return tokens.id_token;
}
