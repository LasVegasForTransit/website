import { workspacePolicy, type WorkspacePolicy } from './workspace-onboarding';
export interface WorkspaceConnectorPolicy extends WorkspacePolicy {
  consoleGroupEmail: string;
  productionConsoleGroupEmail: string;
  managedGroups: string[];
  productionGroups: string[];
  retiredConsoleGroupEmails?: string[];
  productionRetiredConsoleGroupEmails?: string[];
}
export interface WorkspaceGroupPlan {
  kind: 'console' | 'committee';
  personId: string | null;
  customerId: string;
  userId: string;
  email: string | null;
  operationId: string;
  revision: string;
  groups: { resourceId: string; desired: boolean }[];
}
export interface WorkspaceGroupClaim {
  token: string;
  plan: WorkspaceGroupPlan;
}
function validGroups(p: WorkspaceConnectorPolicy): boolean {
  const address = (v: unknown) =>
    typeof v === 'string' &&
    v.length <= 254 &&
    /^[a-z0-9][a-z0-9._+-]*@lasvegasfortransit\.org$/.test(v);
  const list = (v: unknown) => Array.isArray(v) && v.length <= 100 && v.every(address);
  return (
    address(p.consoleGroupEmail) &&
    address(p.productionConsoleGroupEmail) &&
    [
      p.managedGroups,
      p.productionGroups,
      p.retiredConsoleGroupEmails ?? [],
      p.productionRetiredConsoleGroupEmails ?? [],
    ].every(list)
  );
}
export function connectorPolicy(value: unknown): WorkspaceConnectorPolicy | null {
  if (!workspacePolicy(value)) return null;
  const p = value as WorkspaceConnectorPolicy;
  if (!validGroups(p)) return null;
  const managed = [p.consoleGroupEmail, ...p.managedGroups, ...(p.retiredConsoleGroupEmails ?? [])];
  const production = [
    p.productionConsoleGroupEmail,
    ...p.productionGroups,
    ...(p.productionRetiredConsoleGroupEmails ?? []),
  ];
  if (p.environment === 'preview' && managed.some((v) => production.includes(v))) return null;
  if (p.environment === 'production' && managed.some((v) => !production.includes(v))) return null;
  return p;
}
