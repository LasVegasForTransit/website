export interface DiscordRoleChoice {
  id: string;
  name: string;
}
export interface CurrentDiscordRole extends DiscordRoleChoice {
  available: boolean;
}
export interface DiscordCommitteeRoleChoices {
  memberRoles: DiscordRoleChoice[];
  leadRoles: DiscordRoleChoice[];
  currentMemberRole: CurrentDiscordRole | null;
  currentLeadRole: CurrentDiscordRole | null;
}
