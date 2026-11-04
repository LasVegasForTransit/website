import type { Db } from '@lasvegasfortransit/platform-storage/db';
import { workScopeKey } from '@lasvegasfortransit/platform-storage/discord-work-types';
import {
  readWorkRoute,
  type WorkRoute,
} from '@lasvegasfortransit/platform-storage/discord-work-routes';
import { readWorkRouteBaseline } from '@lasvegasfortransit/platform-storage/discord-work-route-scans';
import type { resolveWorkActor } from './discord-work-authority';
import { taskMarkdown } from './notion-task-cards';
import { notionObject } from './notion-task-types';
import { setupReceipt, setupReply } from './discord-work-setup-common';
import { workMessage, workText, workButton, workCustomId } from './discord-work-cards';
import type { WorkEffectContext, WorkProviders } from './discord-work-actions';
import type { WorkPreviewInput, WorkPreviewResult } from './discord-work-interactions';

const issueReasons: Record<string, string> = {
  authority_changed: 'Administrator access changed.',
  audience_or_permission_changed: 'Check the destination audience and bot permissions.',
  audience_changed: 'Check the destination audience and bot permissions.',
  eligibility_changed_after_effect:
    'The page no longer matches the route after Discord creation began. Review the existing Discord resource and link before repair.',
  not_eligible: 'The page no longer matches the route.',
  existing_event_review:
    'Check for an existing post and link it, or create one after confirming there is no duplicate.',
  existing_event_unavailable:
    'An existing post was found but is archived, locked, or inaccessible. Restore access before linking it.',
  project_choice_required: 'Choose exactly one project on the Notion page.',
  project_relation_unavailable: 'Check the configured project relation and source access.',
  project_forum_unavailable: 'Create or adopt the project forum in the approved category.',
  forum_tag_required:
    'Select event tags for the project forum with /work project-event-tags, then retry checks.',
  invalid_forum_tag: 'A selected forum tag no longer exists. Review the route tag selection.',
  tag_mapping_unavailable: 'Check the Notion value and mapped forum tag, then retry checks.',
  forum_tags_changed: 'Review the forum post tags before trying again.',
};

function issueMessage(issue: {
  page_id: string;
  reason: string | null;
  kind: 'creation' | 'tags';
}): string {
  const reason =
    issue.reason === 'unconfirmed_effect'
      ? issue.kind === 'tags'
        ? 'The tag update may have succeeded. Check the post; the worker will verify it before retrying.'
        : 'Check Discord before retrying; creation may have succeeded.'
      : (issueReasons[issue.reason ?? ''] ?? 'Check the source, destination and operation status.');
  const pageId =
    typeof issue.page_id === 'string' ? issue.page_id.replaceAll('-', '').toLowerCase() : '';
  return /^[0-9a-f]{32}$/.test(pageId)
    ? `• https://www.notion.so/${pageId} — ${reason}`
    : `• ${reason}`;
}

async function readRouteStatus(db: Db, context: WorkEffectContext, route: WorkRoute) {
  const ready =
    route.state === 'paused' &&
    (await readWorkRouteBaseline(db, context.scope, route.id, route.revision));
  const scan = await db
    .prepare(
      'SELECT last_error FROM discord_work_route_scans WHERE route_id=? AND scope_key=? AND revision=?',
    )
    .bind(route.id, workScopeKey(context.scope), route.revision)
    .first<{ last_error: string | null }>();
  const retryableRequest = await db
    .prepare(
      `SELECT 1 FROM discord_work_requests q WHERE q.scope_key=? AND q.route_id=? AND q.route_revision=? AND ((q.state='held' AND q.operation_id IS NULL AND NOT EXISTS(SELECT 1 FROM discord_work_operations o WHERE o.scope_key=q.scope_key AND o.source_key='route-request:' || q.id)) OR (q.state IN ('held','processing') AND EXISTS(SELECT 1 FROM discord_work_operations o WHERE o.id=q.operation_id AND o.scope_key=q.scope_key AND o.kind='provision' AND o.state='failed' AND o.reason='forum_tag_required' AND o.result_json IS NULL AND o.home_id IS NULL AND json_extract(o.payload_json,'$.intent')='event' AND json_extract(o.payload_json,'$.projectId') IS NOT NULL)) OR (q.state IN ('held','processing') AND EXISTS(SELECT 1 FROM discord_work_operations o WHERE o.id=q.operation_id AND o.scope_key=q.scope_key AND o.kind='provision' AND o.state='held' AND o.reason='eligibility_changed_after_effect' AND (o.home_id IS NOT NULL OR o.result_json IS NOT NULL) AND o.source_key='route-request:' || q.id AND json_extract(o.payload_json,'$.routeId')=q.route_id AND json_extract(o.payload_json,'$.routeRevision')=q.route_revision))) LIMIT 1`,
    )
    .bind(workScopeKey(context.scope), route.id, route.revision)
    .first();
  const retryableTags = await db
    .prepare(
      `SELECT 1 FROM discord_work_operations o WHERE o.scope_key=? AND o.kind='refresh' AND o.state='failed' AND ((o.reason='tag_mapping_unavailable' AND o.result_json IS NULL) OR (o.reason='forum_tags_changed' AND o.result_json IS NOT NULL)) AND json_extract(o.payload_json,'$.intent')='tag-sync' AND json_extract(o.payload_json,'$.routeId')=? AND json_extract(o.payload_json,'$.routeRevision')=?
      AND NOT EXISTS(SELECT 1 FROM discord_work_operations later WHERE later.scope_key=o.scope_key AND later.conversation_id=o.conversation_id AND later.kind='refresh' AND later.state='confirmed' AND json_extract(later.payload_json,'$.intent')='tag-sync' AND json_extract(later.payload_json,'$.routeId')=json_extract(o.payload_json,'$.routeId') AND json_extract(later.payload_json,'$.routeRevision')=json_extract(o.payload_json,'$.routeRevision') AND later.rowid>o.rowid) LIMIT 1`,
    )
    .bind(workScopeKey(context.scope), route.id, route.revision)
    .first();
  const issues = await db
    .prepare(
      `SELECT q.page_id,coalesce(o.reason,q.reason) AS reason FROM discord_work_requests q
    LEFT JOIN discord_work_operations o ON o.id=q.operation_id AND o.scope_key=q.scope_key
    WHERE q.scope_key=? AND q.route_id=? AND (q.state='held' OR o.state IN ('held','failed'))
    ORDER BY q.created_at DESC,q.id LIMIT 6`,
    )
    .bind(workScopeKey(context.scope), route.id)
    .all<{ page_id: string; reason: string | null }>();
  const tagIssues = await db
    .prepare(
      `SELECT json_extract(c.data_json,'$.subject.pageId') AS page_id,o.reason FROM discord_work_operations o JOIN discord_work_conversations c ON c.id=o.conversation_id AND c.scope_key=o.scope_key
    WHERE o.scope_key=? AND o.kind='refresh' AND o.state IN ('held','failed') AND json_extract(o.payload_json,'$.intent')='tag-sync' AND json_extract(o.payload_json,'$.routeId')=? AND json_extract(o.payload_json,'$.routeRevision')=?
    AND (o.state='held' OR NOT EXISTS(SELECT 1 FROM discord_work_operations later WHERE later.scope_key=o.scope_key AND later.conversation_id=o.conversation_id AND later.kind='refresh' AND later.state='confirmed' AND json_extract(later.payload_json,'$.intent')='tag-sync' AND json_extract(later.payload_json,'$.routeId')=json_extract(o.payload_json,'$.routeId') AND json_extract(later.payload_json,'$.routeRevision')=json_extract(o.payload_json,'$.routeRevision') AND later.rowid>o.rowid)) ORDER BY o.created_at DESC,o.id LIMIT 6`,
    )
    .bind(workScopeKey(context.scope), route.id, route.revision)
    .all<{ page_id: string; reason: string | null }>();
  const allIssues = [
    ...issues.results.map((issue) => ({ ...issue, kind: 'creation' as const })),
    ...tagIssues.results.map((issue) => ({ ...issue, kind: 'tags' as const })),
  ];
  const issueText = allIssues.slice(0, 5).map(issueMessage);
  return { ready, scan, retryableRequest, retryableTags, allIssues, issueText };
}

function routeStateLabel(route: WorkRoute, ready: boolean): string {
  if (route.state === 'active') return 'Active';
  return ready ? 'Paused · ready to review' : 'Paused · preparation required';
}

function routeTriggerLabel(route: WorkRoute): string {
  return `${taskMarkdown(route.trigger.property)}: ${route.trigger.values.map(taskMarkdown).join(', ')}`;
}

async function reviewedEvents(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  route: WorkRoute,
) {
  if (route.state !== 'active' || route.kind !== 'event') return [];
  const rows = await db
    .prepare(
      `SELECT q.id,q.page_id FROM discord_work_requests q WHERE q.scope_key=? AND q.route_id=? AND q.route_revision=? AND q.existing_event=1 AND q.state='held' AND q.reason='existing_event_review' AND q.operation_id IS NULL AND NOT EXISTS(SELECT 1 FROM discord_work_operations o WHERE o.scope_key=q.scope_key AND o.source_key='route-request:' || q.id) ORDER BY q.created_at,q.id LIMIT 5`,
    )
    .bind(workScopeKey(context.scope), route.id, route.revision)
    .all<{ id: string; page_id: string }>();
  const options = await Promise.all(
    rows.results.map(async (row) => {
      try {
        const page = notionObject(await providers.notion.readPage(row.page_id));
        const title = Object.values(notionObject(page.properties))
          .map(notionObject)
          .find((property) => property.type === 'title');
        const name = Array.isArray(title?.title)
          ? title.title
              .map((part) => notionObject(part).plain_text)
              .filter((part): part is string => typeof part === 'string')
              .join('')
              .trim()
          : '';
        return name ? { label: name.slice(0, 100), value: row.id } : null;
      } catch {
        return null;
      }
    }),
  );
  return options.filter((option): option is { label: string; value: string } => option !== null);
}

function routeStatusCard(
  route: WorkRoute,
  status: Awaited<ReturnType<typeof readRouteStatus>>,
  context: WorkEffectContext,
  { controlId, events }: { controlId: string; events: { label: string; value: string }[] },
): WorkPreviewResult {
  const { ready, scan, retryableRequest, retryableTags, allIssues, issueText } = status;
  return {
    kind: 'ready',
    card: workMessage([
      workText(
        `### ${taskMarkdown(route.sourceTitle ?? 'Notion source')}\n${routeStateLabel(route, ready)}\n${routeTriggerLabel(route)}\n<#${route.destination.channelId}>${scan?.last_error ? '\nNotion scan interrupted. Check source access and fields; the worker will retry.' : ''}${issueText.length ? `\n\n**Requests needing attention**\n${issueText.join('\n')}${allIssues.length > 5 ? '\nMore requests need attention.' : ''}` : ''}`,
      ),
      {
        type: 1,
        components: [
          workButton(
            workCustomId({ id: controlId, generation: 1 }, 'route-prepare'),
            'Prepare',
            route.state !== 'paused' || !context.enabled,
          ),
          workButton(
            workCustomId({ id: controlId, generation: 1 }, 'route-enable'),
            'Review activation',
            route.state !== 'paused' || !ready || !context.enabled,
          ),
          workButton(
            workCustomId({ id: controlId, generation: 1 }, 'route-pause'),
            'Pause',
            route.state !== 'active',
          ),
          workButton(
            workCustomId({ id: controlId, generation: 1 }, 'route-retry-checks'),
            'Retry checks',
            route.state !== 'active' || (!retryableRequest && !retryableTags) || !context.enabled,
          ),
          workButton(
            workCustomId({ id: controlId, generation: 1 }, 'route-tags-start'),
            'Map tags',
            route.state !== 'paused' || route.destination.kind === 'text' || !context.enabled,
          ),
        ],
      },
      ...(events.length
        ? [
            {
              type: 1 as const,
              components: [
                {
                  type: 3 as const,
                  custom_id: workCustomId({ id: controlId, generation: 1 }, 'route-create-event'),
                  placeholder: 'Create a missing event post',
                  options: events,
                },
              ],
            },
          ]
        : []),
    ]),
  };
}

export async function showWorkRoute(
  db: Db,
  providers: WorkProviders,
  context: WorkEffectContext,
  details: {
    input: WorkPreviewInput;
    actor: NonNullable<Awaited<ReturnType<typeof resolveWorkActor>>>;
    payload: Record<string, unknown>;
  },
): Promise<WorkPreviewResult> {
  const { actor, payload, input } = details;
  if (
    payload.intent !== 'route-list' ||
    !Array.isArray(payload.routeIds) ||
    !payload.routeIds.includes(input.intent.value)
  )
    return setupReply('Choose a route from the list.');
  const route = await readWorkRoute(db, context.scope, String(input.intent.value));
  if (!route) return setupReply('This route is unavailable.');
  const status = await readRouteStatus(db, context, route);
  const control = await setupReceipt(
    db,
    {
      request: input,
      actor,
      payload: { intent: 'route-manage', routeId: route.id, revision: route.revision },
    },
    context,
  );
  const events = await reviewedEvents(db, providers, context, route);
  return routeStatusCard(route, status, context, { controlId: control.id, events });
}
