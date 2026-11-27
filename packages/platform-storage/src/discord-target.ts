const LEAD_PREFIX = 'committee_lead:';
export const REGION_PREFIX = 'region:';
export function discordRegionId(targetId: string): string | null {
  return targetId.startsWith(REGION_PREFIX) ? targetId.slice(REGION_PREFIX.length) : null;
}
export function discordRegionSql(target: string, provider = "'discord'"): string {
  return `(${provider}='discord' AND substr(${target},1,${REGION_PREFIX.length})='${REGION_PREFIX}')`;
}
export function discordLeadTarget(committeeId: string): string {
  return `${LEAD_PREFIX}${committeeId}`;
}
export function discordTarget(targetId: string): { committeeId: string; lead: boolean } {
  const lead = targetId.startsWith(LEAD_PREFIX);
  return { committeeId: lead ? targetId.slice(LEAD_PREFIX.length) : targetId, lead };
}
export function discordLeadSql(target: string, provider = "'discord'"): string {
  return `(${provider}='discord' AND substr(${target},1,${LEAD_PREFIX.length})='${LEAD_PREFIX}')`;
}
export function committeeTargetSql(target: string, provider = "'discord'"): string {
  return `(CASE WHEN ${discordLeadSql(target, provider)} THEN substr(${target},${LEAD_PREFIX.length + 1}) ELSE ${target} END)`;
}
