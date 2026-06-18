/**
 * Minimal Notion REST client shared by the Notion provisioning/intake scripts.
 *
 * Pins the API version to the single source of truth in
 * functions/api/_intake-schema.ts, so every script and the Pages Function speak
 * the same (current) data-source-era API. Pure fetch + JSON — no Node-only
 * globals — so it stays safe to import anywhere.
 */
import { NOTION_VERSION } from '../../../functions/api/_intake-schema.js';

const NOTION_API = 'https://api.notion.com/v1';

export interface NotionResponse {
  ok: boolean;
  status: number;
  json: unknown;
}

export async function notionFetch(
  token: string,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<NotionResponse> {
  const res = await fetch(`${NOTION_API}/${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
}

// Notion responses come back as `unknown`; these read one field safely so the
// callers stay free of repeated object/null/typeof narrowing.
export function getString(obj: unknown, key: string): string | undefined {
  if (typeof obj === 'object' && obj !== null) {
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

export function getArray(obj: unknown, key: string): unknown[] | undefined {
  if (typeof obj === 'object' && obj !== null) {
    const value = (obj as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value;
  }
  return undefined;
}

export function notionErrorMessage(json: unknown): string {
  return getString(json, 'message') ?? 'unknown Notion API error';
}

/**
 * Resolve a database's first data source ID. Databases in the 2025-09-03+ API
 * own one or more data sources; pages and queries target the data source, not
 * the database. Returns undefined if the database has none or the call fails.
 */
export async function resolveDataSourceId(
  token: string,
  databaseId: string,
): Promise<string | undefined> {
  const res = await notionFetch(token, 'GET', `databases/${databaseId}`);
  if (!res.ok) return undefined;
  const sources = getArray(res.json, 'data_sources');
  return sources && sources.length > 0 ? getString(sources[0], 'id') : undefined;
}
