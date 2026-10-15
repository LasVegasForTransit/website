const LEAD_PREFIX = 'committee_lead:';
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
