export interface NotionTaskFields {
  name: string;
  description: string;
  assignee: string;
  due: string;
  status: string;
  project: string;
}
export interface NotionTaskReadOptions {
  sourceId: string;
  fields: NotionTaskFields;
  shareDescription: boolean;
  rangeBoundary: 'reject' | 'start' | 'end';
  hydratedProperties?: ReadonlySet<string>;
  projectsSourceId?: string;
  projectLeadField?: string;
}
export interface NotionTaskSnapshot extends Record<string, unknown> {
  title: string;
  url: string;
  description: string | null;
  assigneeIds: string[];
  /** Display hints only; identity matching always uses the workspace-scoped user ID. */
  assigneeLabels?: { id: string; name: string }[];
  projectIds: string[];
  dueDate: string | null;
  dueTimeZone: string | null;
  status: string;
  ineligibleReason: string | null;
  escalationNotionIds?: string[];
  escalationNeedsReview?: boolean;
}
export function notionObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function notionProperty(page: unknown, key: string): Record<string, unknown> {
  const properties = notionObject(notionObject(page).properties);
  return notionObject(
    properties[key] ?? Object.values(properties).find((p) => notionObject(p).id === key),
  );
}
