export type SupportedOs = 'macos' | 'linux';

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type CapabilityId =
  | 'core-node'
  | 'core-pnpm'
  | 'core-actionlint'
  | 'deploy-gh'
  | 'deploy-wrangler'
  | 'deploy-dig';

export type CommandGroup = 'dev' | 'build' | 'deploy';

export type PhaseId = 'install' | 'auth' | 'workspace' | 'env' | 'repo' | 'deploy' | 'domain';

export type CapabilityStatus = 'ready' | 'failed' | 'deferred' | 'skipped';

export interface CapabilityState {
  status: CapabilityStatus;
  installStatus: CapabilityStatus;
  authStatus: CapabilityStatus | 'not_required';
  detectedVersion?: string;
  details?: string;
  nextAction?: string;
  checkedAt: string;
}

export interface PhaseState {
  status: 'complete' | 'partial' | 'skipped' | 'failed';
  completedAt: string;
  details?: string;
}

export type FollowUpKind = 'local' | 'remote' | 'auth';

export interface FollowUp {
  kind: FollowUpKind;
  message: string;
}

export interface PhaseResult {
  success: boolean;
  followUpItems: FollowUp[];
  details?: string;
}
