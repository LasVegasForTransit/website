import type { Db } from '@lasvegasfortransit/platform-storage/db';
import type { WorkScope } from '@lasvegasfortransit/platform-storage/discord-work-types';
import { resolveWorkActor } from './discord-work-authority';
import { notionObject } from './notion-task-types';
import type { WorkProviders } from './discord-work-actions';

async function isWorkAdmin(
  db: Db,
  providers: WorkProviders,
  scope: WorkScope,
  discordUserId: string,
): Promise<boolean> {
  const actor = await resolveWorkActor(db, scope, discordUserId);
  return Boolean(
    actor?.administrator && (await providers.discord.membership(discordUserId, scope.guildId)),
  );
}

/** Lists only sources the configured integration can discover; selection does not approve a route. */
export async function discoverWorkSources(
  db: Db,
  providers: WorkProviders,
  {
    scope,
    discordUserId,
    input,
  }: { scope: WorkScope; discordUserId: string; input: { query: string; cursor: string | null } },
): Promise<
  | { kind: 'ready'; sources: { id: string; title: string }[]; nextCursor: string | null }
  | { kind: 'unavailable' }
> {
  try {
    if (!(await isWorkAdmin(db, providers, scope, discordUserId))) return { kind: 'unavailable' };
    const page = await providers.notion.searchDataSources(input.query.trim(), input.cursor);
    const sources = page.results.flatMap((value) => {
      const row = notionObject(value);
      if (
        row.object !== 'data_source' ||
        typeof row.id !== 'string' ||
        !/^(?:[a-f0-9]{32}|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/i.test(row.id) ||
        row.archived === true ||
        row.in_trash === true ||
        !Array.isArray(row.title)
      )
        return [];
      const title = row.title
        .map((part) =>
          typeof notionObject(part).plain_text === 'string'
            ? String(notionObject(part).plain_text)
            : '',
        )
        .join('')
        .trim()
        .slice(0, 100);
      return [{ id: row.id, title: title || 'Untitled source' }];
    });
    return { kind: 'ready', sources, nextCursor: page.nextCursor };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** Enumerate selectable trigger fields without guessing the source's schema. */
export async function inspectWorkSourceFields(
  db: Db,
  providers: WorkProviders,
  { scope, discordUserId, sourceId }: { scope: WorkScope; discordUserId: string; sourceId: string },
): Promise<
  | { kind: 'ready'; fields: { name: string; type: 'status' | 'select'; values: string[] }[] }
  | { kind: 'unavailable' }
> {
  try {
    if (!(await isWorkAdmin(db, providers, scope, discordUserId))) return { kind: 'unavailable' };
    const source = notionObject(await providers.notion.readDataSource(sourceId));
    if (
      source.object !== 'data_source' ||
      typeof source.id !== 'string' ||
      source.id.replaceAll('-', '').toLowerCase() !== sourceId.replaceAll('-', '').toLowerCase() ||
      source.archived === true ||
      source.in_trash === true
    )
      return { kind: 'unavailable' };
    const fields: { name: string; type: 'status' | 'select'; values: string[] }[] = [];
    for (const [name, value] of Object.entries(notionObject(source.properties))) {
      const property = notionObject(value);
      if (property.type !== 'status' && property.type !== 'select') continue;
      const options = notionObject(property[property.type]).options;
      if (!Array.isArray(options)) return { kind: 'unavailable' };
      const values = options.map((option) => notionObject(option).name);
      if (
        !values.every((option): option is string => typeof option === 'string' && option.length > 0)
      )
        return { kind: 'unavailable' };
      fields.push({ name, type: property.type, values });
    }
    return { kind: 'ready', fields };
  } catch {
    return { kind: 'unavailable' };
  }
}

export async function inspectProjectRelations(
  db: Db,
  providers: WorkProviders,
  {
    scope,
    discordUserId,
    sourceId,
    projectSourceId,
  }: { scope: WorkScope; discordUserId: string; sourceId: string; projectSourceId: string },
): Promise<{ id: string; name: string }[] | null> {
  try {
    if (!(await isWorkAdmin(db, providers, scope, discordUserId))) return null;
    const source = notionObject(await providers.notion.readDataSource(sourceId));
    const canonical = (value: unknown) =>
      typeof value === 'string' ? value.replaceAll('-', '').toLowerCase() : '';
    if (
      source.object !== 'data_source' ||
      canonical(source.id) !== canonical(sourceId) ||
      source.archived === true ||
      source.in_trash === true
    )
      return null;
    return Object.entries(notionObject(source.properties)).flatMap(([name, value]) => {
      const property = notionObject(value),
        relation = notionObject(property.relation);
      return property.type === 'relation' &&
        typeof property.id === 'string' &&
        property.id.length > 0 &&
        property.id.length <= 128 &&
        canonical(relation.data_source_id) === canonical(projectSourceId)
        ? [{ id: property.id, name }]
        : [];
    });
  } catch {
    return null;
  }
}
