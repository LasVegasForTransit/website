import type { WorkRoute } from '@lasvegasfortransit/platform-storage/discord-work-routes';
import { notionObject, notionProperty } from './notion-task-types';

/** Resolve names separately in each destination forum; Discord tag IDs are forum-specific. */
export function resolveMappedForumTag(
  page: unknown,
  mapping: NonNullable<WorkRoute['tagSync']>,
  tags: { id: string; name: string }[],
): { kind: 'ready'; tagId: string } | { kind: 'review' } {
  const property = notionProperty(page, mapping.property);
  if (property.type !== 'select' && property.type !== 'status') return { kind: 'review' };
  const selected = notionObject(property[property.type]).name;
  if (typeof selected !== 'string') return { kind: 'review' };
  const choices = mapping.mappings.filter((item) => item.value === selected);
  if (choices.length !== 1) return { kind: 'review' };
  const found = tags.filter((tag) => tag.name === choices[0]?.tagName);
  return found.length === 1 && found[0]?.id
    ? { kind: 'ready', tagId: found[0].id }
    : { kind: 'review' };
}

/** Plan a tag update without claiming tags that an organizer already applied. */
export function planManagedForumTags(input: {
  current: string[];
  managed: string[];
  desired: string[];
  available: string[];
  required: boolean;
}): { kind: 'update'; tags: string[]; managed: string[] } | { kind: 'review' } {
  const { current, managed, desired, available } = input;
  const unique = (values: string[]) =>
    values.every(Boolean) && new Set(values).size === values.length;
  if (
    !unique(current) ||
    !unique(managed) ||
    !unique(desired) ||
    !unique(available) ||
    current.length > 5 ||
    managed.some((tag) => !current.includes(tag)) ||
    [...current, ...desired].some((tag) => !available.includes(tag))
  )
    return { kind: 'review' };
  const tags = current.filter((tag) => !managed.includes(tag) || desired.includes(tag));
  const owned = managed.filter((tag) => desired.includes(tag));
  for (const tag of desired) {
    if (!tags.includes(tag)) {
      tags.push(tag);
      owned.push(tag);
    }
  }
  if (tags.length > 5 || (input.required && !tags.length)) return { kind: 'review' };
  return { kind: 'update', tags, managed: owned };
}
