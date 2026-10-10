import { DiscordHttp } from './discord-http';
import {
  DiscordApiFailure,
  discordConfigured,
  discordId,
  parseDiscordMember,
  type DiscordConfiguration,
  type DiscordMember,
  type DiscordOptions,
} from './discord-types';
export { DiscordApiFailure, type DiscordConfiguration, type DiscordMember } from './discord-types';
export interface DiscordReconciliation {
  identityId: string;
  managedRoleIds: string[];
  desiredRoleIds: string[];
  operationId: string;
  /** Reload current ownership, membership, mappings, generations and the account lease. */
  isCurrent: () => Promise<boolean>;
  journal?: {
    observe: (member: DiscordMember | null) => Promise<void>;
    prepare: (change: { resourceId: string; wasGranted: boolean }) => Promise<boolean>;
  };
}
function validate(input: DiscordReconciliation, guildId: string): void {
  if (
    !discordId(input.identityId) ||
    !input.operationId.length ||
    input.operationId.length > 200 ||
    ![input.managedRoleIds, input.desiredRoleIds].every(
      (roles) => roles.length <= 1000 && roles.every(discordId),
    ) ||
    input.desiredRoleIds.some((id) => !input.managedRoleIds.includes(id)) ||
    input.managedRoleIds.includes(guildId)
  )
    throw new DiscordApiFailure('not_configured');
}
export class DiscordAccess {
  private readonly http: DiscordHttp;
  readonly configuration: Readonly<DiscordConfiguration>;
  constructor(configuration: DiscordConfiguration, options: DiscordOptions = {}) {
    this.configuration = Object.freeze({ ...configuration });
    this.http = new DiscordHttp(options);
  }
  private configured(identityId: string): void {
    if (!discordConfigured(this.configuration) || !discordId(identityId))
      throw new DiscordApiFailure('not_configured');
  }
  async readMember(identityId: string): Promise<DiscordMember | null> {
    this.configured(identityId);
    const data = await this.http.request(
      `/guilds/${this.configuration.guildId}/members/${identityId}`,
      { authorization: `Bot ${this.configuration.botToken}`, unknownMember: true },
    );
    return data === null ? null : parseDiscordMember(data, identityId);
  }
  private async role(input: DiscordReconciliation, roleId: string, add: boolean): Promise<void> {
    if (!(await input.isCurrent())) throw new DiscordApiFailure('stale_operation');
    await this.http.request(
      `/guilds/${this.configuration.guildId}/members/${input.identityId}/roles/${roleId}`,
      {
        method: add ? 'PUT' : 'DELETE',
        authorization: `Bot ${this.configuration.botToken}`,
        reason: `LVBT membership reconciliation ${input.operationId}`,
      },
    );
  }
  private async applyChanges(
    input: DiscordReconciliation,
    current: DiscordMember,
    deadline: number,
  ): Promise<boolean> {
    const remove = current.roles.filter(
      (id) => input.managedRoleIds.includes(id) && !input.desiredRoleIds.includes(id),
    );
    const add = [...new Set(input.desiredRoleIds)].filter((id) => !current.roles.includes(id));
    for (const change of [
      ...remove.map((id) => ({ id, add: false })),
      ...add.map((id) => ({ id, add: true })),
    ]) {
      if (this.http.now() >= deadline) throw new DiscordApiFailure('provider_unavailable');
      if (change.add && current.pending) throw new DiscordApiFailure('screening_pending');
      if (
        input.journal &&
        !(await input.journal.prepare({
          resourceId: change.id,
          wasGranted: current.roles.includes(change.id),
        }))
      )
        throw new DiscordApiFailure('stale_operation');
      await this.role(input, change.id, change.add);
    }
    return Boolean(remove.length || add.length);
  }
  async reconcile(input: DiscordReconciliation): Promise<DiscordMember | null> {
    validate(input, this.configuration.guildId);
    this.configured(input.identityId);
    if (!(await input.isCurrent())) throw new DiscordApiFailure('stale_operation');
    const deadline = this.http.now() + 30_000;
    const current = await this.readMember(input.identityId);
    if (!(await input.isCurrent())) throw new DiscordApiFailure('stale_operation');
    await input.journal?.observe(current);
    if (current === null) return null;
    const changed = await this.applyChanges(input, current, deadline);
    const observed = changed ? await this.readMember(input.identityId) : current;
    if (!(await input.isCurrent())) throw new DiscordApiFailure('stale_operation');
    if (observed !== current) await input.journal?.observe(observed);
    const actual = observed?.roles.filter((id) => input.managedRoleIds.includes(id)).sort() ?? [];
    const desired = [...new Set(input.desiredRoleIds)].sort();
    if (JSON.stringify(actual) !== JSON.stringify(desired))
      throw new DiscordApiFailure('provider_unavailable');
    return observed;
  }
}
