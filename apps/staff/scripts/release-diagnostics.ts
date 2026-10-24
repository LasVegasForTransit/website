import {
  DISCORD_RUNTIME_CONFIG,
  STAFF_WORKER_BINDINGS,
} from '@lasvegasfortransit/platform-integrations/worker-runtime-config';

export interface DiagnosticCheck {
  id: string;
  status: 'failed' | 'unverified';
}
export interface SafeDiagnostics {
  checks: DiagnosticCheck[];
  httpStatus?: number;
  cloudflareCodes?: number[];
}
const variables = [
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
];
const knownChecks = new Set([
  'provider.metadata',
  'cloudflare.read',
  'source.site.database',
  'source.staff.database',
  'source.jobs.database',
  'source.staff.domain',
  'source.staff.assets',
  'source.jobs.exposure',
  'source.discord.enabled',
  'staff.domain',
  'staff.authentication',
  'source.staff.authentication',
  'version.authentication',
  'staff.no_bot_token',
  'staff.newsletter_service',
  'staff.no_newsletter_secrets',
  'jobs.exposure',
  'jobs.schedule',
  'jobs.newsletter_configuration',
  'access.application',
  'access.policy',
  'database.migrations',
  'discord.configuration',
  ...['staff', 'jobs'].flatMap((app) => [
    `${app}.deployment`,
    `${app}.database`,
    `${app}.version_configuration`,
    `setup.${app}.source`,
    `setup.${app}.traffic`,
    `setup.${app}.version_metadata`,
    `setup.${app}.disabled`,
  ]),
  'setup.jobs.schedule',
  ...Object.entries(STAFF_WORKER_BINDINGS).flatMap(([app, names]) =>
    names.map((name) => `${app}.binding.${name}`),
  ),
  ...[
    'id',
    'annotation',
    'services',
    'database',
    'forbidden_bindings',
    'newsletter',
    'metadata',
  ].map((suffix) => `version.${suffix}`),
  ...variables.map((name) => `version.variable.${name}`),
  ...[...new Set(Object.values(STAFF_WORKER_BINDINGS).flat())].map(
    (name) => `version.binding.${name}`,
  ),
]);

/** Only allowlisted local checks and bounded numeric provider metadata cross the CLI boundary. */
export class ReleaseDiagnosticError extends Error {
  readonly diagnostics: SafeDiagnostics;
  constructor(
    checks: { id: string; status: string }[],
    provider: { httpStatus?: unknown; cloudflareCodes?: unknown } = {},
  ) {
    super('Release checks could not be satisfied.');
    this.diagnostics = {
      checks: checks
        .filter(
          (check) => knownChecks.has(check.id) && ['failed', 'unverified'].includes(check.status),
        )
        .map(({ id, status }) => ({ id, status: status as DiagnosticCheck['status'] })),
    };
    if (
      Number.isInteger(provider.httpStatus) &&
      Number(provider.httpStatus) >= 100 &&
      Number(provider.httpStatus) <= 599
    )
      this.diagnostics.httpStatus = Number(provider.httpStatus);
    if (Array.isArray(provider.cloudflareCodes)) {
      const codes = [
        ...new Set(
          provider.cloudflareCodes.filter(
            (code): code is number =>
              typeof code === 'number' && Number.isInteger(code) && code > 0 && code <= 999999,
          ),
        ),
      ].slice(0, 10);
      if (codes.length) this.diagnostics.cloudflareCodes = codes;
    }
  }
}
export function safeDiagnostics(error: unknown): SafeDiagnostics | undefined {
  return error instanceof ReleaseDiagnosticError ? error.diagnostics : undefined;
}
export function diagnosticSummary(diagnostics?: SafeDiagnostics) {
  if (!diagnostics) return '';
  const details = diagnostics.checks.map(({ id, status }) => `${status} ${id}`);
  if (diagnostics.httpStatus !== undefined) details.push(`HTTP ${diagnostics.httpStatus}`);
  if (diagnostics.cloudflareCodes?.length)
    details.push(`Cloudflare codes ${diagnostics.cloudflareCodes.join(', ')}`);
  return details.length ? ` Checks: ${details.join('; ')}.` : '';
}
