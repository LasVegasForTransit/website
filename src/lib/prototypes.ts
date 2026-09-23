// Prototypes: clickable, coded versions of a flow, built from the app
// patterns with made-up data, for testing with real people before the flow is
// built. Each has a metadata file in src/prototypes/ and pages under
// src/pages/prototypes/<name>/. Guide: docs/guides/add-a-prototype.md.

export const PROTOTYPE_STATUSES = ['draft', 'testing', 'tested', 'built'] as const;
export type PrototypeStatus = (typeof PROTOTYPE_STATUSES)[number];

export interface Prototype {
  name: string;
  status: PrototypeStatus;
  /** the plan the prototype belongs to. */
  task: string;
  taskTitle: string;
  /** When it last changed, as YYYY-MM-DD. */
  updated: string;
  path: string;
}

export const PROTOTYPE_BANNER = 'Prototype: this is a test version. Nothing you enter is saved.';

export function listPrototypes(): Prototype[] {
  const files = import.meta.glob<{ default: Prototype }>('../prototypes/*.json', { eager: true });
  return Object.values(files)
    .map((file) => file.default)
    .sort((a, b) => a.name.localeCompare(b.name));
}
