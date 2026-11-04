import type { AccessConfiguration, ProviderAccess } from '@lasvegasfortransit/platform-core/access';
import { t } from '@lasvegasfortransit/platform-core/messages';
import { discordTarget, type AccessRow } from '@lasvegasfortransit/platform-storage/access-view';
import { accessLabel } from './account-access';

export function profileProviders(row: AccessRow, configuration: AccessConfiguration) {
  const discord = {
    name: row.targetId === 'person' ? t('staff.access.memberChannels') : t('staff.common.discord'),
    access: row.discord,
    resource: row.discordResourceId,
    configured: Boolean(configuration.discord?.configured && configuration.discord.contextId),
  };
  if (row.targetId === 'person') return [discord];
  const providers = discordTarget(row.targetId).lead
    ? [discord]
    : [
        {
          name: t('staff.access.googleGroup'),
          access: row.googleWorkspace,
          resource: row.googleResourceId,
          configured: Boolean(
            configuration.google_workspace?.configured &&
            configuration.google_workspace.contextId &&
            (!configuration.google_workspace.resourceIds ||
              configuration.google_workspace.resourceIds.includes(row.googleResourceId ?? '')),
          ),
        },
        discord,
      ];
  return providers.filter(
    ({ access, resource, configured }) =>
      configured && resource && !['not_mapped', 'not_configured'].includes(access.reason ?? ''),
  );
}

export function profileNeedsRecovery(row: AccessRow, configuration: AccessConfiguration): boolean {
  if (row.operationState !== 'retry') return false;
  const expected = row.expectedAccess ? 'granted' : 'absent';
  return profileProviders(row, configuration).some(
    ({ access, configured }) =>
      configured &&
      (access.reason === 'stale'
        ? access.lastConfirmedState
          ? access.lastConfirmedState !== expected
          : row.lastFailure !== null
        : access.state === 'unknown'
          ? [
              'provider_unavailable',
              'permission_denied',
              'rate_limited',
              'unknown',
              'not_checked',
            ].includes(access.reason ?? '')
          : access.state !== expected),
  );
}

export function profileAccessLabel(access: ProviderAccess, expected: boolean): string {
  if (access.lastConfirmedState)
    return access.lastConfirmedState === 'granted'
      ? t('staff.access.lastGranted')
      : t('staff.access.lastAbsent');
  if (access.reason === 'stale' || access.reason === 'not_checked')
    return expected ? t('staff.access.accessNotConfirmed') : t('staff.access.removalNotConfirmed');
  return accessLabel(access, expected);
}
