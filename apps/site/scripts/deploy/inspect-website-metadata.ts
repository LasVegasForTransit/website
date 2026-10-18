import { pathToFileURL } from 'node:url';

const resources = [
  ['bindings', '/workers/services/lvbt-website/environments/production/bindings'],
  ['routes', '/workers/services/lvbt-website/environments/production/routes?show_zonename=true'],
  [
    'custom-domains',
    '/workers/domains/records?page=0&per_page=5&service=lvbt-website&environment=production',
  ],
  ['subdomain', '/workers/services/lvbt-website/environments/production/subdomain'],
  ['environment', '/workers/services/lvbt-website/environments/production'],
  ['schedules', '/workers/scripts/lvbt-website/schedules'],
] as const;
const configurationMessage =
  'Set valid CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in the protected production environment.';
type Resource = (typeof resources)[number];
type Request = (url: string, options: RequestInit) => Promise<Response>;
export interface WebsiteMetadataEnvironment {
  CLOUDFLARE_ACCOUNT_ID?: string | undefined;
  CLOUDFLARE_API_TOKEN?: string | undefined;
}
export interface WebsiteMetadataReport {
  resource: Resource[0];
  status: number | null;
  success: boolean;
  errorCodes: number[];
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function providerResult(body: unknown): Pick<WebsiteMetadataReport, 'success' | 'errorCodes'> {
  if (
    !record(body) ||
    typeof body.success !== 'boolean' ||
    (body.errors !== undefined && body.errors !== null && !Array.isArray(body.errors))
  )
    return { success: false, errorCodes: [] };
  const errors: unknown[] = body.errors ?? [];
  return {
    success: body.success && errors.length === 0,
    errorCodes: errors.flatMap((error) =>
      record(error) &&
      typeof error.code === 'number' &&
      Number.isSafeInteger(error.code) &&
      error.code >= 0
        ? [error.code]
        : [],
    ),
  };
}
async function inspectResource(
  [resource, path]: Resource,
  configuration: { account: string; token: string },
  request: Request,
): Promise<WebsiteMetadataReport> {
  let status: number | null = null;
  try {
    const response = await request(
      `https://api.cloudflare.com/client/v4/accounts/${configuration.account}${path}`,
      {
        method: 'GET',
        redirect: 'manual',
        headers: { Authorization: `Bearer ${configuration.token}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    status = response.status;
    if (status >= 300 && status < 400) return { resource, status, success: false, errorCodes: [] };
    const body: unknown = await response.json();
    const result = providerResult(body);
    return {
      resource,
      status,
      success: response.ok && result.success,
      errorCodes: result.errorCodes,
    };
  } catch {
    return { resource, status, success: false, errorCodes: [] };
  }
}

export async function inspectWebsiteMetadata(
  environment: WebsiteMetadataEnvironment,
  request: Request = fetch,
): Promise<WebsiteMetadataReport[]> {
  const account = environment.CLOUDFLARE_ACCOUNT_ID;
  const token = environment.CLOUDFLARE_API_TOKEN;
  if (!account || !/^[a-f0-9]{32}$/iu.test(account) || !token?.trim() || /[\r\n]/u.test(token))
    throw new Error(configurationMessage);
  return await Promise.all(
    resources.map((resource) => inspectResource(resource, { account, token }, request)),
  );
}

export async function runWebsiteMetadataDiagnostics(
  environment: WebsiteMetadataEnvironment,
  request: Request = fetch,
  write: (output: string) => void = (output) => {
    process.stdout.write(output);
  },
): Promise<number> {
  let reports: WebsiteMetadataReport[];
  try {
    reports = await inspectWebsiteMetadata(environment, request);
  } catch {
    write(`${configurationMessage}\n`);
    return 1;
  }
  write(`${JSON.stringify(reports)}\n`);
  return reports.every(({ success }) => success) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await runWebsiteMetadataDiagnostics({
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
  });
