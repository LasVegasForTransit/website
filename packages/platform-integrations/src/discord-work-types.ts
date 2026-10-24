export type {
  WorkScope,
  WorkSubject,
  WorkDestination,
  WorkState,
  ProjectHome,
  WorkConversation,
  WorkOperation,
  WorkOperationInput,
  WorkOutcome,
} from '@lasvegasfortransit/platform-storage/discord-work-types';
export interface WorkActor {
  personId: string;
  displayName?: string | undefined;
  discordUserId: string;
  notionUserIds: string[];
  grantVersion: string;
  administrator: boolean;
}
export type WorkAction = 'manage_home' | 'place_work' | 'comment' | 'set_status';
export interface WorkResult {
  kind: 'idle' | 'progress' | 'paused' | 'failed';
  reason?: string | undefined;
}
export interface WorkMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  text: string;
  bot: boolean;
  webhook: boolean;
  system: boolean;
  contentAvailable: boolean;
  attachmentOnly: boolean;
}
