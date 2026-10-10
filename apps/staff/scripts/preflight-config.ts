import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';
import { array, object } from './preflight-api';
import { discordProviderConfiguration } from '@lasvegasfortransit/platform-integrations/discord-runtime';
export type Environment = 'production' | 'preview';
export interface Check {
  id: string;
  status: 'passed' | 'failed' | 'unverified';
  detail: string;
}
export function check(id: string, passed: boolean, detail: string): Check {
  return { id, status: passed ? 'passed' : 'failed', detail };
}
async function configuration(root: string, app: string): Promise<Record<string, unknown>> {
  const path = resolve(root, `apps/${app}/wrangler.jsonc`);
  const parsed = ts.parseConfigFileTextToJson(path, await readFile(path, 'utf8'));
  if (parsed.error) throw new Error('Invalid Worker configuration');
  return object(parsed.config);
}
function target(config: Record<string, unknown>, environment: Environment) {
  return environment === 'production'
    ? config
    : { ...config, ...object(object(config.env)[environment]) };
}
function database(config: Record<string, unknown>) {
  return array(config.d1_databases).find((binding) => binding.binding === 'PLATFORM_DB');
}
export async function releaseConfiguration(root: string, environment: Environment) {
  const source = await Promise.all([
    configuration(root, 'site'),
    configuration(root, 'staff'),
    configuration(root, 'jobs'),
  ]);
  const site = target(source[0], environment);
  const staff = target(source[1], environment);
  const jobs = target(source[2], environment);
  const db = database(site);
  const productionDb = database(source[0]);
  const hostname = `${environment === 'preview' ? 'staff-preview' : 'staff'}.lasvegasfortransit.org`;
  const canonical = resolve(root, 'packages/platform-storage/migrations');
  const checks = ['site', 'staff', 'jobs'].map((name, index) => {
    const config = [site, staff, jobs][index];
    const binding = database(config);
    return check(
      `source.${name}.database`,
      typeof db?.database_id === 'string' &&
        binding?.database_id === db.database_id &&
        (environment === 'production' || db.database_id !== productionDb?.database_id) &&
        resolve(
          root,
          `apps/${name}`,
          typeof binding.migrations_dir === 'string' ? binding.migrations_dir : '',
        ) === canonical,
      'All applications must share the canonical database and migrations; preview must be isolated.',
    );
  });
  checks.push(
    check(
      'source.staff.domain',
      array(staff.routes ?? []).some(
        (route) => route.pattern === hostname && route.custom_domain === true,
      ),
      'Configure the staff custom domain.',
    ),
  );
  checks.push(
    check(
      'source.staff.assets',
      object(staff.assets).run_worker_first === true,
      'Every staff asset must pass through the protected Worker.',
    ),
  );
  checks.push(
    check(
      'source.jobs.exposure',
      jobs.workers_dev === false &&
        jobs.preview_urls === false &&
        jobs.route === undefined &&
        array(jobs.routes ?? []).length === 0,
      'The jobs Worker must have no public route.',
    ),
  );
  checks.push(
    check(
      'source.discord.enabled',
      discordProviderConfiguration(object(staff.vars)).configured &&
        discordProviderConfiguration(object(jobs.vars)).configured,
      'Discord remains disabled until maintainers configure and verify both applications.',
    ),
  );
  return {
    checks,
    environment,
    hostname,
    databaseId: typeof db?.database_id === 'string' ? db.database_id : '',
    staffWorker: String(staff.name),
    jobsWorker: String(jobs.name),
    migrations: (await readdir(canonical)).filter((name) => name.endsWith('.sql')).sort(),
  };
}
