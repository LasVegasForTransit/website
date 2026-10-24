import {
  notionObject,
  notionProperty,
  type NotionTaskReadOptions,
  type NotionTaskSnapshot,
} from './notion-task-types';

function text(value: unknown): string {
  return Array.isArray(value)
    ? value
        .map((part: unknown) => {
          const rich = notionObject(part);
          return typeof rich.plain_text === 'string' ? rich.plain_text : '';
        })
        .join('')
    : '';
}
function ids(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const result: string[] = [];
  for (const item of value) {
    const id = notionObject(item).id;
    if (typeof id !== 'string' || !id || id.length > 100) return null;
    result.push(id);
  }
  return [...new Set(result)].sort();
}
function assigneeLabels(value: unknown, assigned: string[]): { id: string; name: string }[] {
  const names = new Map<string, string>();
  if (Array.isArray(value))
    for (const item of value) {
      const user = notionObject(item);
      if (typeof user.id !== 'string' || typeof user.name !== 'string') continue;
      const name = user.name
        .replace(/\s+/gu, ' ')
        .replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, '')
        .trim()
        .slice(0, 160);
      if (name) names.set(user.id, name);
    }
  return assigned.flatMap((id) => {
    const name = names.get(id);
    return name ? [{ id, name }] : [];
  });
}
function validDate(value: unknown, zone: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const start = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== date) return null;
  if (value === date) return date;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.test(value))
    return null;
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  if (!zoned) {
    if (typeof zone !== 'string') return null;
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone }).format(start);
    } catch {
      return null;
    }
  }
  const instant = new Date(zoned ? value : `${value}Z`);
  return Number.isFinite(instant.getTime()) ? (zoned ? instant.toISOString() : value) : null;
}
function privateNotionUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      ['notion.so', 'www.notion.so', 'app.notion.com'].includes(url.hostname) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
interface Assignment {
  assigneeIds: string[];
  projectIds: string[];
  incompleteAssignees: boolean;
  incompleteProjects: boolean;
}
function assignments(page: unknown, options: NotionTaskReadOptions): Assignment {
  const f = options.fields;
  const assignee = notionProperty(page, f.assignee),
    project = notionProperty(page, f.project);
  const assigneeIds = ids(assignee.people),
    projectIds = ids(project.relation);
  return {
    assigneeIds: assigneeIds ?? [],
    projectIds: projectIds ?? [],
    incompleteAssignees:
      !assigneeIds || (assigneeIds.length >= 25 && !options.hydratedProperties?.has(f.assignee)),
    incompleteProjects:
      !projectIds || (project.has_more === true && !options.hydratedProperties?.has(f.project)),
  };
}
function header(row: Record<string, unknown>, sourceId: string) {
  const parent = notionObject(row.parent);
  if (
    row.object !== 'page' ||
    typeof row.id !== 'string' ||
    typeof row.last_edited_time !== 'string' ||
    typeof parent.data_source_id !== 'string' ||
    parent.data_source_id.replaceAll('-', '') !== sourceId.replaceAll('-', '')
  )
    return null;
  const edited = new Date(row.last_edited_time);
  return Number.isFinite(edited.getTime())
    ? { taskId: row.id, sourceEditedAt: edited.toISOString() }
    : null;
}
function deadline(page: unknown, options: NotionTaskReadOptions) {
  const date = notionObject(notionProperty(page, options.fields.due).date);
  const hasRange = date.end !== null && date.end !== undefined;
  const due = options.rangeBoundary === 'end' && hasRange ? date.end : date.start;
  return {
    dueDate: validDate(due, date.time_zone),
    dueTimeZone: typeof date.time_zone === 'string' ? date.time_zone : null,
    unconfirmedRange: hasRange && options.rangeBoundary === 'reject',
  };
}
function ineligibleReason(
  row: Record<string, unknown>,
  snapshot: NotionTaskSnapshot,
  assignment: Assignment,
  unconfirmedRange: boolean,
): string | null {
  const rules: [boolean, string][] = [
    [row.archived === true, 'archived'],
    [row.in_trash === true, 'archived'],
    [!snapshot.title, 'missing_name'],
    [!snapshot.url, 'invalid_link'],
    [assignment.incompleteAssignees, 'incomplete_assignment'],
    [!snapshot.assigneeIds.length, 'unassigned'],
    [assignment.incompleteProjects, 'incomplete_project'],
    [!snapshot.dueDate, 'invalid_deadline'],
    [unconfirmedRange, 'unconfirmed_date_range'],
    [snapshot.status === 'Done', 'completed'],
    [!['Not started', 'In progress', 'Done'].includes(snapshot.status), 'unsupported_status'],
  ];
  return rules.find(([invalid]) => invalid)?.[1] ?? null;
}
export function parseNotionTaskPage(
  page: unknown,
  options: NotionTaskReadOptions,
): {
  taskId: string;
  sourceEditedAt: string;
  active: boolean;
  snapshot: NotionTaskSnapshot;
} | null {
  const row = notionObject(page),
    metadata = header(row, options.sourceId);
  if (!metadata) return null;
  const assignment = assignments(page, options),
    due = deadline(page, options);
  const status = notionObject(notionProperty(page, options.fields.status).status).name;
  const snapshot: NotionTaskSnapshot = {
    title: text(notionProperty(page, options.fields.name).title).trim().slice(0, 300),
    url: privateNotionUrl(row.url) ?? '',
    description: options.shareDescription
      ? text(notionProperty(page, options.fields.description).rich_text).slice(0, 1200)
      : null,
    assigneeIds: assignment.assigneeIds,
    assigneeLabels: assigneeLabels(
      notionProperty(page, options.fields.assignee).people,
      assignment.assigneeIds,
    ),
    projectIds: assignment.projectIds,
    dueDate: due.dueDate,
    dueTimeZone: due.dueTimeZone,
    status: typeof status === 'string' ? status : '',
    ineligibleReason: null,
  };
  snapshot.ineligibleReason = ineligibleReason(row, snapshot, assignment, due.unconfirmedRange);
  return { ...metadata, active: snapshot.ineligibleReason === null, snapshot };
}
