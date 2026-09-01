/**
 * How one membership submission becomes a Notion intake page.
 *
 * Shared by the Pages Function (live submissions) and the offline backfill so
 * the two can't drift: the same field coercion, the same page body, the same
 * duplicate lookup. Columns come from functions/api/_intake-schema.ts.
 */
import { INTAKE_PROPERTIES as PROP } from '../../../functions/api/_intake-schema.js';
import { NOTION_CHILDREN_LIMIT, clampToNotionLimit, paragraphBlock } from './notion-blocks.js';
import { isRecord } from './notion-client.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_SOURCE = 'Google Forms membership intake';

/** Values written for one submission, after coercion. */
export interface IntakeFields {
  /** Normalized (trimmed, lower-cased) email. */
  email: string;
  name?: string;
  discord?: string;
  source?: string;
  submittedAt?: string;
  rawResponseUrl?: string;
  responseId?: string;
  answers?: unknown;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/**
 * Coerce an endpoint-shaped body (what Apps Script posts) into IntakeFields.
 * Non-string fields are treated as absent; a missing or malformed email makes
 * the whole body unusable, so that returns undefined.
 */
export function intakeFieldsFromBody(body: Record<string, unknown>): IntakeFields | undefined {
  const email = asString(body.email)?.toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return undefined;
  return {
    email,
    name: asString(body.name),
    discord: asString(body.discord),
    source: asString(body.sourceForm),
    submittedAt: asString(body.submittedAt),
    rawResponseUrl: asString(body.rawResponseUrl),
    responseId: asString(body.responseId),
    answers: body.answers,
  };
}

function plainTextProperty(value: string | undefined) {
  return value ? { rich_text: [{ text: { content: value } }] } : { rich_text: [] };
}

function pageProperties(fields: IntakeFields) {
  return {
    [PROP.name.label]: { title: [{ text: { content: fields.name || fields.email } }] },
    [PROP.email.label]: { email: fields.email },
    [PROP.discord.label]: plainTextProperty(fields.discord),
    [PROP.source.label]: plainTextProperty(fields.source || DEFAULT_SOURCE),
    [PROP.submittedAt.label]: fields.submittedAt
      ? { date: { start: fields.submittedAt } }
      : { date: null },
    [PROP.rawResponse.label]: fields.rawResponseUrl
      ? { url: fields.rawResponseUrl }
      : { url: null },
    [PROP.responseId.label]: plainTextProperty(fields.responseId),
  };
}

// Each answer is its own bulleted list item so staff see a real list in Notion
// (rich_text does not parse markdown) and no single block can exceed the
// rich_text limit. Past the block limit the remainder is summarised; the
// response sheet still holds every answer.
function pageChildren(answers: unknown) {
  if (!isRecord(answers) || Object.keys(answers).length === 0) {
    return [paragraphBlock('No additional answers supplied.')];
  }

  const blocks = Object.entries(answers).map(([question, answer]) => {
    const value = Array.isArray(answer) ? answer.join(', ') : String(answer ?? '');
    return {
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [
          { type: 'text', text: { content: clampToNotionLimit(`${question}: ${value}`) } },
        ],
      },
    };
  });
  if (blocks.length <= NOTION_CHILDREN_LIMIT) return blocks;

  const kept = blocks.slice(0, NOTION_CHILDREN_LIMIT - 1);
  const omitted = blocks.length - kept.length;
  return [
    ...kept,
    paragraphBlock(`${omitted} more answers omitted from this page; see the raw response.`),
  ];
}

/** Body of the Notion "create a page" request for one submission. */
export function intakePage(dataSourceId: string, fields: IntakeFields) {
  return {
    parent: { data_source_id: dataSourceId },
    properties: pageProperties(fields),
    children: pageChildren(fields.answers),
  };
}

/**
 * Data-source query that finds the page already created for a submission. The
 * form's response ID is the real key; without one, fall back to the email.
 */
export function intakeLookupQuery(fields: IntakeFields) {
  const filter = fields.responseId
    ? { property: PROP.responseId.label, rich_text: { equals: fields.responseId } }
    : { property: PROP.email.label, email: { equals: fields.email } };
  return { filter, page_size: 1 };
}
