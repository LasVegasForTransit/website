import type { AccessFailure } from '@lasvegasfortransit/platform-core/access';

export type GoogleGroupFailure =
  | AccessFailure
  | 'not_configured'
  | 'invalid_response'
  | 'stale_operation'
  | 'identity_changed'
  | 'inherited_access';
export class GoogleGroupsFailure extends Error {
  constructor(
    readonly kind: GoogleGroupFailure,
    readonly retryAfterMs: number | null = null,
  ) {
    super(`Google group request failed: ${kind}`);
    this.name = 'GoogleGroupsFailure';
  }
}
export interface GoogleTokenSource {
  getToken(scopes: readonly string[]): Promise<string>;
}
export interface GoogleGroupsConfiguration {
  environment: 'production' | 'preview';
  customerId: string;
  /** Include retained historical mappings as well as current committee groups. */
  managedGroups: readonly string[];
  /** Complete production registry, including retired groups; preview must be disjoint. */
  productionGroups: readonly string[];
}
export interface GoogleGroupsOptions {
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  rateLimit?: {
    current(): Promise<number | null>;
    defer(retryAfterMs: number): Promise<void>;
  };
}
export type GoogleGroupRole = 'MEMBER' | 'MANAGER' | 'OWNER';
export interface GoogleGroupObservation {
  identityId: string;
  identityEmail: string | null;
  groupId: string;
  groupEmail: string;
  direct: boolean;
  granted: boolean;
  role: GoogleGroupRole | null;
}
export interface GoogleGroupReconciliation {
  identityId: string;
  identityEmail: string | null;
  groupEmail: string;
  desired: boolean;
  operationId: string;
  /** Reload verified ownership, membership, mappings, generations and the account lease. */
  isCurrent(): Promise<boolean>;
  journal?: {
    observe(state: GoogleGroupObservation): Promise<void>;
    prepare(change: { resourceId: string; wasGranted: boolean }): Promise<boolean>;
  };
}
export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new GoogleGroupsFailure('invalid_response');
  return value as Record<string, unknown>;
}
export function stableId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
export function workspaceEmail(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 254 &&
    /^[a-z0-9][a-z0-9._+-]*@lasvegasfortransit\.org$/.test(value)
  );
}
