import type { CollectionEntry } from 'astro:content';

type Project = CollectionEntry<'projects'>;
export type ProjectStatus = Project['data']['status'];

/**
 * Single source of truth for the /projects-vs-/roadmap split: `planned`
 * means it's still backlog, not real public work yet. Everything else
 * (active, complete, paused) is fair game to show as a project. Also used
 * to keep each program's own project list in sync with the same rule.
 */
export function isActiveProject(project: Project): boolean {
  return project.data.status !== 'planned';
}

// Shared "Month Year" formatter for a project's startDate — used by every
// page/component that displays it, so there's one spec instead of several
// independently-typed copies.
export const MONTH_YEAR_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

export interface ProjectDisplayStatus {
  status: ProjectStatus;
  // Set only when the label needs to override the status's default text —
  // e.g. an `active` project whose start date hasn't arrived yet reads as
  // "Starts {Month Year}" rather than a bare "Active" that isn't true yet.
  label?: string;
}

/**
 * What a project's status pill should actually show. Computed once here so
 * "is this active project actually upcoming" is defined in exactly one
 * place, not re-derived by every consumer that renders a status pill.
 */
export function projectDisplayStatus(project: Project): ProjectDisplayStatus {
  const { status, startDate } = project.data;
  if (status === 'active' && startDate.getTime() > Date.now()) {
    return { status: 'planned', label: `Starts ${MONTH_YEAR_FORMATTER.format(startDate)}` };
  }
  return { status };
}

/**
 * Sort projects by their `order` field ascending (with a high default for
 * unset values), then alphabetically by title. Used by every page that
 * lists projects so the rendered order stays consistent.
 */
export function byOrderThenTitle(a: Project, b: Project): number {
  const ao = a.data.order ?? 999;
  const bo = b.data.order ?? 999;
  if (ao !== bo) return ao - bo;
  return a.data.title.localeCompare(b.data.title);
}
