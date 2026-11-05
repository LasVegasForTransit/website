import {
  GoogleGroups,
  GoogleGroupsFailure,
} from '@lasvegasfortransit/platform-integrations/google-groups';
import type { WorkspaceGroupClaim } from '@lasvegasfortransit/platform-core/workspace-connector';
import type { ConnectorConfig } from './config';
import type { ManagedGoogleCredentials } from './credentials';
import type { Site } from './site';
import { ConnectorFailure } from './http';
export class GroupExecutor {
  private readonly groups: GoogleGroups;
  constructor(
    private readonly config: ConnectorConfig,
    credentials: ManagedGoogleCredentials,
    private readonly context: {
      fetch: typeof fetch;
      now: () => Date;
      site: Site;
      deadline: number;
    },
  ) {
    this.groups = new GoogleGroups(
      {
        environment: config.environment,
        customerId: config.customerId,
        managedGroups: [
          config.consoleGroupEmail,
          ...config.managedGroups,
          ...(config.retiredConsoleGroupEmails ?? []),
        ],
        productionGroups: [
          config.productionConsoleGroupEmail,
          ...config.productionGroups,
          ...(config.productionRetiredConsoleGroupEmails ?? []),
        ],
      },
      credentials,
      {
        fetch: context.fetch,
        now: () => context.now().getTime(),
        rateLimit: {
          current: () => Promise.resolve(null),
          defer: async (retryAfterMs) => {
            await context.site.action('backoff', { retryAfterMs });
          },
        },
      },
    );
  }
  async run(personId?: string) {
    for (
      let count = 0;
      count < 3 && this.context.now().getTime() < this.context.deadline - 5000;
      count++
    ) {
      const result = await this.context.site.action('claim', personId ? { personId } : {});
      if (result.kind === 'idle') return;
      const claim = result as unknown as WorkspaceGroupClaim;
      if (typeof claim.token !== 'string' || !Array.isArray(claim.plan.groups))
        throw new ConnectorFailure('invalid_response');
      if (
        this.config.environment === 'preview' &&
        !this.config.previewUserIds?.includes(claim.plan.userId)
      )
        throw new ConnectorFailure('invalid_response');
      await this.reconcile(claim);
    }
  }
  private async reconcile({ token, plan }: WorkspaceGroupClaim) {
    let resourceId: string | null = null;
    try {
      for (const group of plan.groups) {
        if (this.context.now().getTime() >= this.context.deadline - 5000)
          throw new ConnectorFailure('provider_unavailable');
        resourceId = group.resourceId;
        await this.groups.reconcile({
          identityId: plan.userId,
          identityEmail: plan.email,
          groupEmail: group.resourceId,
          desired: group.desired,
          operationId: plan.operationId,
          isCurrent: () => this.context.site.current(token),
          journal: {
            prepare: (change) => this.context.site.accepted('prepare', { token, ...change }),
            observe: async (observation) => {
              await this.context.site.accepted('observed', { token, observation });
            },
          },
        });
      }
      await this.context.site.accepted('finish', { token });
    } catch (error) {
      const failure = failureFrom(error, resourceId);
      await this.context.site.accepted('finish', { token, failure });
      if (failure.kind === 'rate_limited')
        throw new ConnectorFailure('rate_limited', failure.retryAfterMs);
    }
  }
}

function failureFrom(error: unknown, resourceId: string | null) {
  const kind = error instanceof GoogleGroupsFailure ? error.kind : 'provider_unavailable';
  return {
    kind: ['rate_limited', 'permission_denied'].includes(kind) ? kind : 'provider_unavailable',
    retryAfterMs: error instanceof GoogleGroupsFailure ? (error.retryAfterMs ?? 60000) : 60000,
    resourceId,
    ...(kind === 'inherited_access' ? { reviewReason: 'inherited_access' } : {}),
  };
}
