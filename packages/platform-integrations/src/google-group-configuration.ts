import { stableId, workspaceEmail, type GoogleGroupsConfiguration } from './google-groups-types';

function groupList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 10000 && value.every(workspaceEmail);
}
export function parseGoogleGroupList(value: string | undefined): readonly string[] | null {
  if (value === undefined || value === '') return [];
  if (value.length > 131072) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return groupList(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
/** Read-only groups may be shared; preview write targets must be disjoint. */
export function validGoogleGroupConfiguration(config: GoogleGroupsConfiguration): boolean {
  const readOnly = config.readOnlyGroups ?? [];
  return (
    stableId(config.customerId) &&
    config.customerId !== 'my_customer' &&
    ['production', 'preview'].includes(config.environment) &&
    groupList(config.managedGroups) &&
    groupList(config.productionGroups) &&
    groupList(readOnly) &&
    (config.managedGroups.length > 0 || readOnly.length > 0) &&
    (config.managedGroups.length === 0 || config.productionGroups.length > 0) &&
    config.managedGroups.every((email) =>
      config.environment === 'production'
        ? config.productionGroups.includes(email)
        : !config.productionGroups.includes(email),
    ) &&
    !config.managedGroups.some((email) => readOnly.includes(email))
  );
}
