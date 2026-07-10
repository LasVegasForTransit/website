import type { CollectionEntry } from 'astro:content';

type Project = CollectionEntry<'projects'>;

/**
 * Single source of truth for the /projects-vs-/roadmap split: `planned`
 * means it's still backlog, not real public work yet. Everything else
 * (active, complete, paused) is fair game to show as a project. Also used
 * to keep each program's own project list in sync with the same rule.
 */
export function isActiveProject(project: Project): boolean {
  return project.data.status !== 'planned';
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
