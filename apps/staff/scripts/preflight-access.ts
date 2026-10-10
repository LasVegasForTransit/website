import { type MetadataClient, array, object } from './preflight-api';
import { check, type Check } from './preflight-config';
function duration(value: unknown): boolean {
  return value === '12h' || value === '43200s';
}
function allowedPolicy(policy: Record<string, unknown>): boolean {
  const include = array(policy.include ?? []);
  return (
    policy.decision === 'allow' &&
    (policy.session_duration === undefined || duration(policy.session_duration)) &&
    include.length === 1 &&
    object(include[0]?.gsuite).email === 'console-users@lasvegasfortransit.org' &&
    typeof object(include[0]?.gsuite).identity_provider_id === 'string' &&
    array(policy.require ?? []).some(
      (rule) => object(rule.email_domain).domain === 'lasvegasfortransit.org',
    )
  );
}
export async function inspectAccess(
  client: MetadataClient,
  hostname: string,
  audience: unknown,
): Promise<Check[]> {
  const apps = await client.list('/access/apps');
  const matches = apps.filter((app) => app.domain === hostname);
  const app = matches.at(0);
  if (matches.length !== 1 || typeof app?.id !== 'string')
    return [
      check(
        'access.application',
        false,
        'Create one Access application for the exact staff hostname.',
      ),
    ];
  const policies = await client.list(`/access/apps/${encodeURIComponent(app.id)}/policies`);
  const allowing = policies.filter((policy) => policy.decision !== 'deny');
  return [
    check(
      'access.application',
      app.type === 'self_hosted' &&
        typeof audience === 'string' &&
        audience.length > 0 &&
        app.aud === audience &&
        duration(app.session_duration),
      'Staff Access audience and twelve-hour application session must match.',
    ),
    check(
      'access.policy',
      allowing.length > 0 && allowing.every(allowedPolicy),
      'Every admitting policy must require the console-users Google group and LVBT email domain; bypass is forbidden.',
    ),
  ];
}
