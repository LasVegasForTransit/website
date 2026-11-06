import { connectorPolicy } from '@lasvegasfortransit/platform-core/workspace-connector';
import { ConnectorFailure } from './http';
export interface ConnectorConfig {
  environment: 'preview' | 'production';
  customerId: string;
  origin: string;
  siteAudience: string;
  schedulerSubject: string;
  serviceAccount: string;
  consoleGroupEmail: string;
  productionConsoleGroupEmail: string;
  managedGroups: string[];
  productionGroups: string[];
  retiredConsoleGroupEmails?: string[];
  productionRetiredConsoleGroupEmails?: string[];
  humanOrgUnitIds?: string[];
  includedUserIds?: string[];
  excludedUserIds?: string[];
  previewUserIds?: string[];
}
export function validateConfig(config: ConnectorConfig) {
  if ('delegatedAdmin' in config) throw new ConnectorFailure('not_configured');
  const policy = connectorPolicy({
    ...config,
    humanOrgUnitIds: config.humanOrgUnitIds ?? [],
    includedUserIds: config.includedUserIds ?? [],
    excludedUserIds: config.excludedUserIds ?? [],
    previewUserIds: config.previewUserIds ?? [],
  });
  if (
    !policy ||
    !/^\d{10,30}$/.test(config.schedulerSubject) ||
    !/^[a-z][a-z0-9-]+@[a-z][a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(config.serviceAccount)
  )
    throw new ConnectorFailure('not_configured');
  validateUrls(config);
  return config;
}
function validateUrls(config: ConnectorConfig) {
  const origin = new URL(config.origin),
    site = new URL(config.siteAudience);
  if (
    origin.protocol !== 'https:' ||
    origin.origin !== config.origin ||
    site.protocol !== 'https:' ||
    site.username ||
    site.password ||
    site.search ||
    site.hash ||
    !site.pathname.endsWith('/api/workspace/v1')
  )
    throw new ConnectorFailure('not_configured');
}
export function loadConfig(environment: NodeJS.ProcessEnv): ConnectorConfig {
  const text = environment.WORKSPACE_CONNECTOR_CONFIG;
  if (!text || text.length > 65536) throw new ConnectorFailure('not_configured');
  return validateConfig(JSON.parse(text) as ConnectorConfig);
}
