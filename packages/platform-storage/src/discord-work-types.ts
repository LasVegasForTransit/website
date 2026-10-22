export interface WorkScope {
  environment: 'preview' | 'production';
  guildId: string;
  workspaceId: string;
}
export interface WorkSubject {
  kind: 'task' | 'project_plan' | 'event_plan';
  sourceId: string;
  pageId: string;
}
export interface WorkDestination {
  kind: 'text' | 'forum' | 'thread';
  channelId: string;
  parentId: string | null;
}
export type WorkState = 'preview' | 'active' | 'paused' | 'unlinked';
export interface ProjectHome {
  id: string;
  scope: WorkScope;
  projectSourceId: string;
  projectId: string;
  destination: WorkDestination;
  taskParent: WorkDestination | null;
  audienceFingerprint: string;
  approvedBy: string;
  state: WorkState;
  generation: number;
  title?: string | undefined;
  summaryMessageId?: string | undefined;
  summaryChannelId?: string | undefined;
  taskSourceId?: string | undefined;
  reason?: string | undefined;
}
export interface WorkConversation {
  id: string;
  scope: WorkScope;
  subject: WorkSubject;
  homeId: string;
  placementProjectId: string;
  threadId: string;
  starterMessageId: string;
  cardChannelId?: string | undefined;
  mode: 'automatic' | 'selected';
  state: WorkState;
  generation: number;
  activationId: string;
  cursorId: string;
  windowUpperId: string | null;
  windowBeforeId: string | null;
  footerBlockIds: string[];
  title?: string | undefined;
  reason?: string | undefined;
}
export interface WorkOperationInput {
  id: string;
  scope: WorkScope;
  homeId: string | null;
  conversationId: string | null;
  generation: number;
  kind: 'provision' | 'backlink' | 'comment' | 'status' | 'refresh';
  sourceKey: string;
  actorPersonId: string | null;
  actorDiscordId: string;
  grantVersion: string;
  originalAuthorId: string;
  payload: Record<string, unknown>;
  preview?: boolean | undefined;
}
export interface WorkOperation {
  id: string;
  scope_key: string;
  home_id: string | null;
  conversation_id: string | null;
  generation: number;
  kind: WorkOperationInput['kind'];
  source_key: string;
  actor_person_id: string | null;
  actor_discord_id: string;
  grant_version: string;
  original_author_id: string;
  payload_json: string;
  state: string;
  attempts: number;
  claim_token: string;
  lease_expires_at: string;
  result_json: string | null;
  expires_at: string | null;
  reason: string | null;
}
export interface WorkOutcome {
  state: 'confirmed' | 'retryable' | 'held' | 'superseded' | 'failed';
  reason?: string | undefined;
  providerIds?: Record<string, unknown>;
  retryAfterMs?: number | undefined;
}
export function workScopeKey(scope: WorkScope): string {
  return JSON.stringify([scope.environment, scope.guildId, scope.workspaceId]);
}
export function workSubjectKey(subject: WorkSubject): string {
  return JSON.stringify([subject.kind, subject.sourceId, subject.pageId]);
}
