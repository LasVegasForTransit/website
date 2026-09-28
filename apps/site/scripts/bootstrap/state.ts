import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  CapabilityId,
  CapabilityState,
  CommandGroup,
  PhaseId,
  PhaseState,
} from './lib/types.js';

const STATE_VERSION = 1;
const STATE_DIR = '.lvbt';

export interface ReadinessState {
  version: number;
  generatedAt: string;
  capabilities: Partial<Record<CapabilityId, CapabilityState>>;
  commandReadiness: Record<CommandGroup, 'ready' | 'blocked'>;
  phases: Partial<Record<PhaseId, PhaseState>>;
  /**
   * Setup steps outside bootstrap's reach that the person confirmed done,
   * such as creating a Google Group. Bootstrap asks about each only once.
   */
  confirmations?: Record<string, { confirmedAt: string }>;
  /**
   * The last value bootstrap stored for each platform secret that is not a
   * credential (an ID, a domain, a public key), so a later run can show it.
   * Cloudflare and GitHub never show a stored value again. Credentials are
   * never recorded here.
   */
  recordedValues?: Record<string, { value: string; storedAt: string }>;
}

function stateFilePath(projectRoot: string): string {
  return path.join(projectRoot, STATE_DIR, 'dev-readiness.json');
}

export function loadReadiness(projectRoot: string): ReadinessState {
  const filePath = stateFilePath(projectRoot);
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as ReadinessState;
      if (parsed.version === STATE_VERSION) return parsed;
    } catch {
      // fall through to fresh state
    }
  }
  return createEmptyState();
}

export function saveReadiness(projectRoot: string, state: ReadinessState): void {
  const filePath = stateFilePath(projectRoot);
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  state.generatedAt = new Date().toISOString();
  writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n');
}

export function markPhase(
  state: ReadinessState,
  phaseId: PhaseId,
  status: PhaseState['status'],
  details?: string,
): void {
  state.phases[phaseId] = {
    status,
    completedAt: new Date().toISOString(),
    details,
  };
}

export function isConfirmed(state: ReadinessState, id: string): boolean {
  return state.confirmations?.[id] !== undefined;
}

export function markConfirmed(state: ReadinessState, id: string): void {
  state.confirmations = { ...state.confirmations, [id]: { confirmedAt: new Date().toISOString() } };
}

export function recordedValue(state: ReadinessState, name: string): string | undefined {
  return state.recordedValues?.[name]?.value;
}

export function recordValue(state: ReadinessState, name: string, value: string): void {
  state.recordedValues = {
    ...state.recordedValues,
    [name]: { value, storedAt: new Date().toISOString() },
  };
}

export function markCapability(
  state: ReadinessState,
  id: CapabilityId,
  update: Partial<CapabilityState>,
): void {
  const existing = state.capabilities[id];
  const next: CapabilityState = {
    status: 'ready',
    installStatus: 'ready',
    authStatus: 'not_required',
    ...existing,
    ...update,
    checkedAt: new Date().toISOString(),
  };
  state.capabilities[id] = next;
}

function createEmptyState(): ReadinessState {
  return {
    version: STATE_VERSION,
    generatedAt: new Date().toISOString(),
    capabilities: {},
    commandReadiness: {
      dev: 'blocked',
      build: 'blocked',
      deploy: 'blocked',
    },
    phases: {},
  };
}
