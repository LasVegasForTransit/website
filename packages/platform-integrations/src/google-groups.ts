import { GoogleGroupsHttp } from './google-groups-http';
import {
  GoogleGroupsFailure,
  record,
  stableId,
  workspaceEmail,
  type GoogleGroupsConfiguration,
  type GoogleGroupsOptions,
  type GoogleTokenSource,
  type GoogleGroupObservation,
  type GoogleGroupReconciliation,
  type GoogleGroupRole,
} from './google-groups-types';
export { GoogleGroupsFailure } from './google-groups-types';
export type {
  GoogleGroupsConfiguration,
  GoogleGroupsOptions,
  GoogleTokenSource,
  GoogleGroupObservation,
  GoogleGroupReconciliation,
} from './google-groups-types';

export class GoogleGroups {
  readonly configuration: Readonly<GoogleGroupsConfiguration>;
  private readonly http: GoogleGroupsHttp;
  constructor(
    configuration: GoogleGroupsConfiguration,
    tokens: GoogleTokenSource,
    options: GoogleGroupsOptions = {},
  ) {
    this.configuration = Object.freeze({
      ...configuration,
      managedGroups: Object.freeze([...configuration.managedGroups]),
      productionGroups: Object.freeze([...configuration.productionGroups]),
    });
    this.http = new GoogleGroupsHttp(tokens, options);
  }
  private validate(input: GoogleGroupReconciliation): void {
    const config = this.configuration;
    if (
      !stableId(config.customerId) ||
      config.customerId === 'my_customer' ||
      ![config.managedGroups, config.productionGroups].every(
        (groups) => groups.length > 0 && groups.length <= 10000 && groups.every(workspaceEmail),
      ) ||
      !['production', 'preview'].includes(config.environment) ||
      config.managedGroups.some((email) =>
        config.environment === 'production'
          ? !config.productionGroups.includes(email)
          : config.productionGroups.includes(email),
      ) ||
      !config.managedGroups.includes(input.groupEmail) ||
      !workspaceEmail(input.groupEmail) ||
      !stableId(input.identityId) ||
      (input.desired && !workspaceEmail(input.identityEmail)) ||
      typeof input.desired !== 'boolean' ||
      !/^[\x21-\x7e]{1,200}$/.test(input.operationId)
    )
      throw new GoogleGroupsFailure('not_configured');
  }
  private async current(input: GoogleGroupReconciliation): Promise<void> {
    if (!(await input.isCurrent())) throw new GoogleGroupsFailure('stale_operation');
  }
  private async verifyUser(input: GoogleGroupReconciliation, deadline: number): Promise<void> {
    const user = record(
      await this.http.request(
        `/users/${encodeURIComponent(input.identityId)}?projection=basic&viewType=admin_view`,
        {},
        deadline,
      ),
    );
    if (
      user.id !== input.identityId ||
      user.customerId !== this.configuration.customerId ||
      user.primaryEmail !== input.identityEmail
    )
      throw new GoogleGroupsFailure('identity_changed');
    if (user.suspended !== false || (user.archived !== undefined && user.archived !== false))
      throw new GoogleGroupsFailure('permission_denied');
  }
  private async group(input: GoogleGroupReconciliation, deadline: number): Promise<string> {
    const group = record(
      await this.http.request(`/groups/${encodeURIComponent(input.groupEmail)}`, {}, deadline),
    );
    if (!stableId(group.id) || group.email !== input.groupEmail)
      throw new GoogleGroupsFailure('invalid_response');
    return group.id;
  }
  private member(value: unknown, identityId: string): GoogleGroupRole | null {
    if (value === null) return null;
    const member = record(value);
    if (
      member.id !== identityId ||
      member.type !== 'USER' ||
      !['MEMBER', 'MANAGER', 'OWNER'].includes(String(member.role))
    )
      throw new GoogleGroupsFailure('invalid_response');
    return member.role as GoogleGroupRole;
  }
  private async read(
    input: GoogleGroupReconciliation,
    groupId: string,
    deadline: number,
  ): Promise<GoogleGroupObservation> {
    const path = `/groups/${encodeURIComponent(groupId)}`;
    const member = await this.http.request(
      `${path}/members/${encodeURIComponent(input.identityId)}`,
      { missingMember: true },
      deadline,
    );
    const role = this.member(member, input.identityId);
    const effective = record(
      await this.http.request(
        `${path}/hasMember/${encodeURIComponent(input.identityId)}`,
        {},
        deadline,
      ),
    );
    if (typeof effective.isMember !== 'boolean' || (role !== null && !effective.isMember))
      throw new GoogleGroupsFailure('invalid_response');
    return {
      identityId: input.identityId,
      identityEmail: input.identityEmail,
      groupId,
      groupEmail: input.groupEmail,
      direct: role !== null,
      granted: effective.isMember,
      role,
    };
  }
  async observe(input: GoogleGroupReconciliation): Promise<GoogleGroupObservation> {
    this.validate(input);
    await this.current(input);
    const deadline = this.http.now() + 30000;
    if (input.desired) await this.verifyUser(input, deadline);
    const groupId = await this.group(input, deadline);
    const result = await this.read(input, groupId, deadline);
    await this.current(input);
    return result;
  }
  private async apply(
    input: GoogleGroupReconciliation,
    before: GoogleGroupObservation,
    deadline: number,
  ): Promise<GoogleGroupObservation> {
    if (
      input.journal &&
      !(await input.journal.prepare({ resourceId: input.groupEmail, wasGranted: before.granted }))
    )
      throw new GoogleGroupsFailure('stale_operation');
    if (input.desired) await this.verifyUser(input, deadline);
    await this.current(input);
    const path = `/groups/${encodeURIComponent(before.groupId)}/members`;
    if (input.desired) {
      if (!workspaceEmail(input.identityEmail)) throw new GoogleGroupsFailure('not_configured');
      const inserted = await this.http.request(
        path,
        { method: 'POST', body: { email: input.identityEmail, role: 'MEMBER' } },
        deadline,
      );
      if (inserted !== null) this.member(inserted, input.identityId);
    } else
      await this.http.request(
        `${path}/${encodeURIComponent(input.identityId)}`,
        { method: 'DELETE' },
        deadline,
      );
    const after = await this.read(input, before.groupId, deadline);
    await this.current(input);
    await input.journal?.observe(after);
    return after;
  }
  async reconcile(input: GoogleGroupReconciliation): Promise<GoogleGroupObservation> {
    this.validate(input);
    await this.current(input);
    const deadline = this.http.now() + 30000;
    if (input.desired) await this.verifyUser(input, deadline);
    const groupId = await this.group(input, deadline);
    const before = await this.read(input, groupId, deadline);
    await this.current(input);
    await input.journal?.observe(before);
    const change = input.desired ? !before.direct : before.direct;
    const after = change ? await this.apply(input, before, deadline) : before;
    await this.current(input);
    if (after.granted !== input.desired)
      throw new GoogleGroupsFailure(
        after.granted && !after.direct ? 'inherited_access' : 'provider_unavailable',
      );
    if (input.desired && !after.direct) throw new GoogleGroupsFailure('provider_unavailable');
    return after;
  }
}
