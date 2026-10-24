import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import { object, array } from './preflight-api';
import { DISCORD_RUNTIME_CONFIG } from '@lasvegasfortransit/platform-integrations/worker-runtime-config';
import { releaseConfiguration, type Environment } from './preflight-config';

const PUBLIC_VARIABLES = new Set([
  ...DISCORD_RUNTIME_CONFIG.map(({ name }) => name),
  'LVBT_GOOGLE_ACCESS_OBSERVATIONS_ENABLED',
  'LVBT_GOOGLE_CUSTOMER_ID',
  'LVBT_GOOGLE_PRODUCTION_CUSTOMER_ID',
  'LVBT_STAFF_AUTH_MODE',
  'LVBT_STAFF_ORIGIN',
  'LVBT_STAFF_PREVIEW_ORIGINS',
  'LVBT_ACCESS_TEAM_DOMAIN',
  'LVBT_ACCESS_AUD',
  'LVBT_GOOGLE_OAUTH_CLIENT_ID',
  'LVBT_BEEHIIV_SYNC_ENABLED',
  'LVBT_BEEHIIV_PUBLICATION_ID',
  'LVBT_BEEHIIV_PRODUCTION_PUBLICATION_ID',
  'LVBT_BEEHIIV_CONFLICT_POLICY',
]);

export async function portableConfiguration(
  root: string,
  app: 'staff' | 'jobs',
  environment: Environment,
) {
  const filename = join(root, 'apps', app, 'wrangler.jsonc');
  const parsed = ts.parseConfigFileTextToJson(filename, await readFile(filename, 'utf8'));
  if (parsed.error) throw new Error('Invalid release configuration.');
  const source = object(parsed.config);
  const selected =
    environment === 'production' ? source : { ...source, ...object(object(source.env).preview) };
  if (Object.keys(object(selected.vars)).some((name) => !PUBLIC_VARIABLES.has(name)))
    throw new Error('Release configuration permits only approved public variables.');
  const services =
    app === 'staff'
      ? [
          {
            binding: 'LVBT_NEWSLETTER_JOBS',
            service: environment === 'preview' ? 'lvbt-jobs-preview' : 'lvbt-jobs',
          },
        ]
      : [];
  if (JSON.stringify(array(selected.services ?? [])) !== JSON.stringify(services))
    throw new Error('Release requires the newsletter service in the same environment.');
  return {
    name: selected.name,
    main: app === 'staff' ? 'worker/entry.mjs' : 'worker/index.js',
    base_dir: 'worker',
    compatibility_date: selected.compatibility_date,
    compatibility_flags: selected.compatibility_flags,
    no_bundle: true,
    find_additional_modules: true,
    rules: [{ type: 'ESModule', globs: ['**/*.mjs', '**/*.js'] }],
    workers_dev: false,
    preview_urls: false,
    ...(app === 'staff'
      ? {
          routes: selected.routes,
          services,
          assets: { ...object(selected.assets), directory: 'assets' },
        }
      : { triggers: selected.triggers }),
    observability: selected.observability,
    vars: selected.vars,
    d1_databases: array(selected.d1_databases).map((db) => ({
      ...db,
      migrations_dir: '../migrations',
    })),
  };
}
export async function validateReleaseConfiguration(root: string) {
  for (const environment of ['preview', 'production'] as const) {
    const result = await releaseConfiguration(root, environment);
    if (
      result.checks.some((item) => item.id !== 'source.discord.enabled' && item.status !== 'passed')
    )
      throw new Error(
        'Release requires isolated canonical databases and protected application configuration.',
      );
    for (const app of ['staff', 'jobs'] as const)
      await portableConfiguration(root, app, environment);
  }
}
