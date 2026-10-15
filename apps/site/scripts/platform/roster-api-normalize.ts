import { rosterObject } from '../../platform/roster-evidence';
import { timestamp, type RosterImportRecord } from '../../platform/roster-classification';
import type { RosterSourceSnapshot } from './roster-source-export';
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const QUESTION = 'Finishing this form will sign you up for our email newsletter. Is this okay?';
function strings(value: unknown): string {
  return Array.isArray(value)
    ? value
        .map((part) => {
          const row = rosterObject(part);
          return typeof row.plain_text === 'string'
            ? row.plain_text
            : text(rosterObject(row.text).content);
        })
        .join('')
    : '';
}
function property(page: Record<string, unknown>, name: string): Record<string, unknown> {
  return rosterObject(rosterObject(page.properties)[name]);
}
function blockAnswers(blocks: unknown[]): string[] {
  return blocks.flatMap((value) => {
    const row = rosterObject(value),
      body = rosterObject(row[String(row.type)]),
      text = strings(body.rich_text);
    return [
      ...(text.startsWith(QUESTION + ': ') ? [text.slice(QUESTION.length + 2)] : []),
      ...(Array.isArray(row.exported_children) ? blockAnswers(row.exported_children) : []),
    ];
  });
}
function notionForm(
  page: Record<string, unknown>,
  precise: ReturnType<typeof timestamp>,
  answers: string[],
  date: unknown,
) {
  return {
    submittedAt: precise.issue === 'valid' ? precise.value : null,
    sourceSubmittedAt: typeof date === 'string' ? date : null,
    membershipAffirmative: null,
    affirmativeAnswer: answers.length === 1 ? answers[0] : null,
    fullName: strings(property(page, 'Name').title) || null,
    discordUsername: strings(property(page, 'Discord').rich_text) || null,
    source: strings(property(page, 'Source').rich_text) || null,
    responseId: strings(property(page, 'Response ID').rich_text) || null,
    rawResponseUrl: property(page, 'Raw response').url ?? null,
  };
}
function notionRecord(input: RosterSourceSnapshot['notion'][number]): RosterImportRecord {
  const { page, blocks } = input,
    date = rosterObject(property(page, 'Submitted at').date).start,
    precise = timestamp(date),
    answers = blockAnswers(blocks);
  const affirmative = answers.length === 1 && answers[0] === 'Yes' && precise.issue === 'valid';
  return {
    source: 'notion_intake',
    sourceId: text(page.id),
    email: text(property(page, 'Email').email),
    newsletter: {
      state: affirmative ? 'active' : 'unknown',
      givenAt: affirmative ? precise.value : null,
      affirmative,
      method: 'unknown',
      wordingVersion: null,
      wording: answers.length ? QUESTION : null,
      answer: answers.length === 1 ? (answers[0] ?? null) : null,
      evidenceReference: 'Original Notion form response',
    },
    form: notionForm(page, precise, answers, date),
  };
}
function beehiivRecord(value: unknown, observedAt: string): RosterImportRecord {
  const row = rosterObject(value),
    created =
      typeof row.created === 'number' && Number.isSafeInteger(row.created) && row.created >= 0
        ? new Date(row.created * 1000).toISOString()
        : null;
  return {
    source: 'beehiiv',
    sourceId: text(row.id),
    email: text(row.email),
    newsletter: {
      state: row.status === 'active' ? 'active' : 'unknown',
      affirmative: false,
      givenAt: null,
      sourceCreatedAt: created,
      observedAt,
      method: 'unknown',
      wordingVersion: null,
      evidenceReference: 'Beehiiv subscriptions API',
    },
    beehiiv: Object.fromEntries(
      [
        'id',
        'status',
        'utm_source',
        'utm_medium',
        'utm_channel',
        'utm_campaign',
        'utm_term',
        'utm_content',
        'referring_site',
      ].map((key) => [key, typeof row[key] === 'string' ? row[key] : '']),
    ),
  };
}
/** API dates remain source facts; a subscription creation date never becomes consent. */
export function normalizeApiRoster(snapshot: RosterSourceSnapshot): RosterImportRecord[] {
  return [
    ...snapshot.beehiiv.map((row) => beehiivRecord(row, snapshot.observedAt)),
    ...snapshot.notion.map(notionRecord),
  ];
}
