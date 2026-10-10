export type AccessProvider = 'google_workspace' | 'discord';
export type ProviderState = 'granted' | 'absent' | 'unknown';
export type AccessFailure =
  'provider_unavailable' | 'rate_limited' | 'permission_denied' | 'unknown';
export interface ProviderConfiguration {
  configured: boolean;
  /** Non-secret account/domain or server ID; confirmations cannot cross contexts. */
  contextId: string;
  memberRoleId?: string | null;
}
export type AccessConfiguration = Partial<Record<AccessProvider, ProviderConfiguration>>;
export interface ProviderAccess {
  state: ProviderState;
  reason:
    | 'ambiguous_account'
    | 'not_linked'
    | 'not_mapped'
    | 'not_configured'
    | 'not_checked'
    | 'stale'
    | AccessFailure
    | null;
  observedAt: string | null;
}
export interface AccessObservation {
  personId: string;
  targetId: string;
  provider: AccessProvider;
  identityId: string;
  identityEmail: string | null;
  resourceId: string;
  contextId: string;
  generation: number;
  expectedAccess: boolean;
  state: ProviderState;
  failure?: AccessFailure;
  observedAt: string;
  expiresAt: string;
}
