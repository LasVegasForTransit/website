import type { CollectionEntry } from 'astro:content';

type Project = CollectionEntry<'projects'>;

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
