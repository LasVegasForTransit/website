import type {
  AccessConfiguration,
  AccessProvider,
  ProviderAccess,
  AccessObservation,
  ProviderConfiguration,
} from '@lasvegasfortransit/platform-core/access';
export interface ObservedRow {
  personId: string;
  targetId: string;
  generation: number;
  expectedAccess: number;
  googleIdentityCount: number;
  discordIdentityCount: number;
  googleIdentity: string | null;
  googleEmail: string | null;
  discordIdentity: string | null;
  workspaceGroupEmail: string | null;
  discordRoleId: string | null;
  googleObservation: string | null;
  discordObservation: string | null;
}
function matchesCurrent(
  observation: AccessObservation,
  context: {
    row: ObservedRow;
    identity: string;
    resource: string;
    contextId: string;
    google: boolean;
    now: Date;
  },
): boolean {
  const { row, identity, resource, contextId, google, now } = context;
  return (
    observation.identityId === identity &&
    observation.resourceId === resource &&
    observation.contextId === contextId &&
    (!google || observation.identityEmail === row.googleEmail) &&
    observation.generation === row.generation &&
    observation.expectedAccess === Boolean(row.expectedAccess) &&
    Date.parse(observation.expiresAt) > now.getTime() &&
    Date.parse(observation.observedAt) <= now.getTime()
  );
}
function accessResource(
  row: ObservedRow,
  provider: AccessProvider,
  config?: ProviderConfiguration,
): string | null | undefined {
  if (provider === 'google_workspace') return row.workspaceGroupEmail;
  return row.targetId === 'person' ? config?.memberRoleId : row.discordRoleId;
}
export function observedAccess(
  row: ObservedRow,
  provider: AccessProvider,
  configuration: AccessConfiguration,
  now: Date,
): ProviderAccess {
  const config = configuration[provider];
  const google = provider === 'google_workspace';
  const identity = google ? row.googleIdentity : row.discordIdentity;
  const resource = accessResource(row, provider, config);
  const saved = google ? row.googleObservation : row.discordObservation;
  const unknown = (
    reason: ProviderAccess['reason'],
    observedAt: string | null = null,
  ): ProviderAccess => ({ state: 'unknown', reason, observedAt });
  if ((google ? row.googleIdentityCount : row.discordIdentityCount) > 1)
    return unknown('ambiguous_account');
  if (!identity) return unknown('not_linked');
  if (!resource) return unknown('not_mapped');
  if (!config?.configured || !config.contextId) return unknown('not_configured');
  if (!saved) return unknown('not_checked');
  const observation = JSON.parse(saved) as AccessObservation;
  if (
    !matchesCurrent(observation, {
      row,
      identity,
      resource,
      contextId: config.contextId,
      google,
      now,
    })
  )
    return unknown('stale', observation.observedAt);
  return {
    state: observation.state,
    reason: observation.state === 'unknown' ? (observation.failure ?? 'unknown') : null,
    observedAt: observation.observedAt,
  };
}
export const OBSERVATION_JSON = `json_object('identityId',identity_id,'identityEmail',identity_email,'resourceId',resource_id,'contextId',context_id,
  'generation',generation,'expectedAccess',json(CASE expected_access WHEN 1 THEN 'true' ELSE 'false' END),'state',state,'failure',failure,'observedAt',observed_at,'expiresAt',expires_at)`;
