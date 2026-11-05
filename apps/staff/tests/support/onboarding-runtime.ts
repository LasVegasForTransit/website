import { readFile } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import {
  Response as RuntimeResponse,
  type V4SharedOptions,
  type V4MiniflareOptions,
  type V4FetchHandler,
  type V4WorkerOptions,
} from 'miniflare';

/** Both compiled apps share D1 while retaining independent session secrets. */
export async function onboardingRuntime(
  options: V4SharedOptions & V4WorkerOptions,
  root: string,
): Promise<V4MiniflareOptions> {
  const {
    host,
    port,
    https,
    httpsKey,
    httpsCert,
    resourcePersistencePath,
    cf,
    telemetry,
    ...staff
  } = options;
  const publicRoot = join(root, '../site');
  const d1Databases = { PLATFORM_DB: 'browser-fixture-db' };
  return {
    host,
    port,
    https,
    httpsKey,
    httpsCert,
    resourcePersistencePath,
    cf,
    telemetry,
    workers: [
      {
        name: 'onboarding-entry',
        modules: true,
        script: `export default {fetch(request,env){
    const u=new URL(request.url);
    if(u.hostname==='discord.com')return new Response('<h1>Fixture Discord authorization</h1><a href="https://preview.lasvegasfortransit.org/account/discord/callback?state='+encodeURIComponent(u.searchParams.get('state')||'')+'&code=fixture-code">Authorize fixture account</a><a href="https://preview.lasvegasfortransit.org/account/discord/callback?state='+encodeURIComponent(u.searchParams.get('state')||'')+'&error=access_denied">Cancel authorization</a>',{headers:{'Content-Type':'text/html'}});
    return u.hostname==='staff-preview.lasvegasfortransit.org'?env.STAFF.fetch(request):env.MEMBER.fetch(request);
  }}`,
        serviceBindings: { STAFF: 'lvbt-staff-browser-fixture', MEMBER: 'onboarding-member' },
        d1Databases,
      },
      {
        ...staff,
        serviceBindings: { ...staff.serviceBindings, LVBT_NEWSLETTER_JOBS: 'onboarding-discord' },
        bindings: {
          ...staff.bindings,
          LVBT_STAFF_DISCORD_REQUIRED: 'true',
          LVBT_MEMBER_ORIGIN: 'https://preview.lasvegasfortransit.org',
          LVBT_DEPLOYMENT_ENV: 'preview',
          LVBT_DISCORD_GUILD_ID: '111111111111111111',
          LVBT_DISCORD_SYNC_ENABLED: 'true',
          LVBT_DISCORD_APPLICATION_ID: '555555555555555555',
          LVBT_DISCORD_PRODUCTION_GUILD_ID: '999999999999999999',
          LVBT_DISCORD_MEMBER_ROLE_ID: '333333333333333333',
        },
      },
      {
        name: 'onboarding-member',
        modules: true,
        script: await readFile(join(publicRoot, '.wrangler/worker/index.js'), 'utf8'),
        compatibilityDate: '2026-09-04',
        compatibilityFlags: ['nodejs_compat'],
        cf: false,
        d1Databases,
        bindings: {
          LVBT_SIGN_IN_SECRET: 'onboarding-public-secret',
          LVBT_LINK_SIGNING_SECRET: 'onboarding-public-links',
          LVBT_DEPLOYMENT_ENV: 'preview',
          LVBT_DISCORD_APPLICATION_ID: '555555555555555555',
          LVBT_DISCORD_CLIENT_SECRET: 'onboarding-client',
        },
        serviceBindings: {
          LVBT_DISCORD_JOBS: 'onboarding-discord',
          // This Miniflare version shares assets:storage across asset directories.
          // Serve the second app's exact built bytes through a private fixture binding.
          ASSETS: builtAssets(join(publicRoot, 'dist')),
        },
        outboundService: discordProvider,
      },
      {
        name: 'onboarding-discord',
        modules: true,
        script: await readFile(join(root, '../jobs/dist/index.js'), 'utf8'),
        compatibilityDate: '2026-09-04',
        compatibilityFlags: ['nodejs_compat'],
        cf: false,
        d1Databases,
        bindings: {
          LVBT_DEPLOYMENT_ENV: 'preview',
          LVBT_DISCORD_SYNC_ENABLED: 'true',
          LVBT_DISCORD_APPLICATION_ID: '555555555555555555',
          LVBT_DISCORD_GUILD_ID: '111111111111111111',
          LVBT_DISCORD_PRODUCTION_GUILD_ID: '999999999999999999',
          LVBT_DISCORD_MEMBER_ROLE_ID: '333333333333333333',
          LVBT_DISCORD_BOT_TOKEN: 'onboarding-bot',
        },
        outboundService: discordProvider,
      },
    ],
  };
}
let joined = false;
let pending = true;
export const onboardingDiscord = {
  reset() {
    joined = false;
    pending = true;
  },
  acceptRules() {
    pending = false;
  },
};
const discordUser = {
  id: '222222222222222222',
  username: 'fixture.team',
  global_name: 'Fixture Team',
  avatar: null,
};
const discordProvider: V4FetchHandler = (request) => {
  const url = new URL(request.url);
  if (url.origin !== 'https://discord.com')
    throw new Error('Unexpected external provider in onboarding fixture');
  if (url.pathname === '/api/v10/oauth2/token')
    return json({
      access_token: 'onboarding-access',
      token_type: 'Bearer',
      scope: 'identify guilds.join',
      expires_in: 600,
    });
  if (url.pathname === '/api/v10/users/@me') return json(discordUser);
  if (url.pathname.includes('/members/')) {
    if (request.method === 'PUT') {
      joined = true;
      return json({ user: discordUser, roles: [], pending, nick: null }, 201);
    }
    return joined
      ? json({ user: discordUser, roles: [], pending, nick: null })
      : json({ code: 10007 }, 404);
  }
  throw new Error('Unexpected Discord operation in onboarding fixture');
};
function json(value: unknown, status = 200) {
  return new RuntimeResponse(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function builtAssets(directory: string): V4FetchHandler {
  return async (request) => {
    const pathname = new URL(request.url).pathname;
    const file = resolve(
      directory,
      '.' + decodeURIComponent(pathname),
      pathname.endsWith('/') ? 'index.html' : '',
    );
    if (!file.startsWith(directory + sep)) return new RuntimeResponse(null, { status: 404 });
    try {
      const bytes = await readFile(file);
      const type =
        (
          {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.svg': 'image/svg+xml',
            '.woff2': 'font/woff2',
          } as Record<string, string>
        )[extname(file)] ?? 'application/octet-stream';
      return new RuntimeResponse(bytes, { headers: { 'Content-Type': type } });
    } catch {
      return new RuntimeResponse(null, { status: 404 });
    }
  };
}
