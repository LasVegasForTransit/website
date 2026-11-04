import type { Db } from '@lasvegasfortransit/platform-storage/db';
import type { WorkScope } from '@lasvegasfortransit/platform-storage/discord-work-types';
import {
  readWorkRoute,
  type WorkRoute,
} from '@lasvegasfortransit/platform-storage/discord-work-routes';
import { recordWorkObservation } from '@lasvegasfortransit/platform-storage/discord-work-requests';
import {
  claimWorkRouteScan,
  completeWorkRouteScanPage,
  deferWorkRouteScan,
} from '@lasvegasfortransit/platform-storage/discord-work-route-scans';
import { notionObject } from './notion-task-types';
import type { NotionTaskClient } from './notion-task-client';
import type { WorkResult } from './discord-work-types';

const canonical = (value: string) => value.replaceAll('-', '').toLowerCase();

function sourceTimes(created: string, edited: string) {
  const createdAt = new Date(created),
    editedAt = new Date(edited);
  if (
    !Number.isFinite(createdAt.getTime()) ||
    !Number.isFinite(editedAt.getTime()) ||
    createdAt > editedAt
  )
    throw new Error('invalid_source_page');
  return { createdAt, editedAt };
}

function isEligible(row: Record<string, unknown>, name: unknown, route: WorkRoute) {
  return (
    row.archived !== true &&
    row.in_trash !== true &&
    typeof name === 'string' &&
    route.trigger.values.includes(name)
  );
}

function sourceObservation(value: unknown, route: WorkRoute) {
  const row = notionObject(value),
    parent = notionObject(row.parent),
    fields = notionObject(row.properties),
    field = notionObject(fields[route.trigger.property]);
  if (
    row.object !== 'page' ||
    typeof row.id !== 'string' ||
    !/^[0-9a-f]{32}$/.test(canonical(row.id)) ||
    typeof parent.data_source_id !== 'string' ||
    canonical(parent.data_source_id) !== canonical(route.sourceId) ||
    typeof row.created_time !== 'string' ||
    typeof row.last_edited_time !== 'string' ||
    (field.type !== 'status' && field.type !== 'select')
  )
    throw new Error('invalid_source_page');
  const valueObject = notionObject(field[field.type]);
  if (
    field[field.type] !== null &&
    (typeof field[field.type] !== 'object' || typeof valueObject.name !== 'string')
  )
    throw new Error('invalid_source_page');
  const eligible = isEligible(row, valueObject.name, route);
  const { createdAt, editedAt } = sourceTimes(row.created_time, row.last_edited_time);

  return { pageId: row.id, eligible, createdAt, editedAt };
}

/** Reads one small page; a successful checkpoint is the only way to advance the cursor. */
export async function runWorkRouteScan(
  db: Db,
  notion: NotionTaskClient,
  scope: WorkScope,
  clock: () => Date,
): Promise<WorkResult> {
  const claim = await claimWorkRouteScan(db, scope, clock());
  if (!claim) return { kind: 'idle' };
  try {
    const route = await readWorkRoute(db, scope, claim.route_id);
    if (
      route?.revision !== claim.revision ||
      (claim.mode === 'scan' ? route.state !== 'active' : route.state !== 'paused')
    )
      return { kind: 'idle' };
    const page = await notion.queryWorkSource(route.sourceId, claim.cursor);
    if (page.results.length > 5 || (page.nextCursor !== null && page.nextCursor === claim.cursor))
      throw new Error('invalid_source_page');
    for (const value of page.results) {
      const observation = sourceObservation(value, route);
      await recordWorkObservation(
        db,
        {
          scope,
          routeId: route.id,
          revision: route.revision,
          ...observation,
          scanToken: claim.claim_token,
        },
        clock(),
      );
    }
    return (await completeWorkRouteScanPage(db, claim, page.nextCursor, clock()))
      ? { kind: 'progress' }
      : { kind: 'idle' };
  } catch {
    await deferWorkRouteScan(db, claim, clock());
    return { kind: 'paused', reason: 'source_unavailable' };
  }
}
