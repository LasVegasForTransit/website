import type { ProjectHome, WorkSubject, WorkDestination } from './discord-work-types';
export type PlacementDecision =
  | { kind: 'choice_required'; projectIds: string[] }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'card_only'; destination: WorkDestination }
  | { kind: 'create'; destination: WorkDestination };
export function planWorkPlacement(
  home: ProjectHome,
  _subject: WorkSubject,
  projectIds: string[],
  chosenProjectId?: string,
): PlacementDecision {
  if (projectIds.length > 1 && !chosenProjectId) return { kind: 'choice_required', projectIds };
  const selected = chosenProjectId ?? projectIds[0];
  if (selected !== home.projectId || !projectIds.includes(selected))
    return { kind: 'unavailable', reason: 'project_mismatch' };
  const destination = home.taskParent ?? home.destination;
  return destination.kind === 'thread'
    ? { kind: 'card_only', destination }
    : { kind: 'create', destination };
}
