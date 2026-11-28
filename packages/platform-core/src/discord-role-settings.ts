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
export interface DiscordRegionRoleChoice {
  id: string;
  name: string;
  roleId: string | null;
  settingsVersion: number;
  roles: DiscordRoleChoice[];
  currentRole: CurrentDiscordRole | null;
}
export interface DiscordRegionRoleChoices {
  regions: DiscordRegionRoleChoice[];
}
