import type { RosterImportRecord } from '../../platform/roster-import';
import { parseRosterCsv } from './roster-beehiiv-csv';

export const NOTION_NEWSLETTER_QUESTION =
  'Finishing this form will sign you up for our email newsletter. Is this okay?';

export interface NotionRosterSource {
  csv: string;
  pages: Array<{ fileName: string; contents: string }>;
  googleCsv?: string;
  googleTimeZone?: string;
}

const COLUMNS = [
  'Name',
  'Discord',
  'Email',
  'Raw response',
  'Response ID',
  'Source',
  'Submitted at',
];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
type Calendar = [number, number, number, number, number, number];
interface DisplayMinute {
  calendar: Calendar;
  zone: 'PDT' | 'PST';
}
interface NativePage {
  id: string;
  fields: Record<string, string>;
  answer: string | null;
}
const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
  timeZoneName: 'short',
});

function dateFor(parts: Calendar) {
  const [year, month, day, hour, minute, second] = parts;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date;
}
function calendarValid(parts: Calendar) {
  const date = dateFor(parts);
  const actual = [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  ];
  return parts.every((part, index) => part === actual[index]);
}
function localAt(instant: number) {
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
  );
  const calendar: Calendar = [
    Number(parts.year),
    Number(parts.month),
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  ];
  return { calendar, zone: parts.timeZoneName };
}
/** Test all nearby offsets by roundtrip; folds return two instants and gaps return none. */
function instantsFor(parts: Calendar): number[] {
  const naive = dateFor(parts).getTime();
  const offsets = new Set(
    [-36, -12, 0, 12, 36].map((hours) => {
      const sample = naive + hours * 3600_000;
      return dateFor(localAt(sample).calendar).getTime() - sample;
    }),
  );
  return [...offsets]
    .map((offset) => naive - offset)
    .filter((instant) => localAt(instant).calendar.every((part, index) => part === parts[index]));
}
function displayMinute(value: string): DisplayMinute | null {
  const match = /^(\w+) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) (AM|PM) \((PDT|PST)\)$/.exec(value);
  if (!match) return null;
  const hour = Number(match[4]);
  if (hour < 1 || hour > 12) return null;
  const calendar: Calendar = [
    Number(match[3]),
    MONTHS.indexOf(match[1] ?? '') + 1,
    Number(match[2]),
    (hour % 12) + (match[6] === 'PM' ? 12 : 0),
    Number(match[5]),
    0,
  ];
  return calendarValid(calendar) ? { calendar, zone: match[7] === 'PDT' ? 'PDT' : 'PST' } : null;
}
function googleCalendar(value: string): Calendar | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const calendar: Calendar = [
    Number(match[3]),
    Number(match[1]),
    Number(match[2]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  ];
  return calendarValid(calendar) ? calendar : null;
}
function submissionMinute(display: DisplayMinute | null): string | null {
  if (!display) return null;
  const matching = instantsFor(display.calendar).filter(
    (instant) => localAt(instant).zone === display.zone,
  );
  if (matching.length !== 1) return null;
  const [year, month, day, hour, minute] = display.calendar.map((value, index) =>
    String(value).padStart(index === 0 ? 4 : 2, '0'),
  );
  return `${year}-${month}-${day}T${hour}:${minute}${display.zone === 'PDT' ? '-07:00' : '-08:00'}`;
}
function preciseSubmission(
  google: Record<string, string> | null,
  display: DisplayMinute | null,
  zone?: string,
): string | null {
  if (!google || !display || zone !== 'America/Los_Angeles') return null;
  const calendar = googleCalendar(google.Timestamp ?? '');
  if (!calendar) return null;
  const instants = instantsFor(calendar);
  const instant = instants[0];
  return instants.length === 1 && instant !== undefined && localAt(instant).zone === display.zone
    ? new Date(instant).toISOString()
    : null;
}
function nativePage(page: NotionRosterSource['pages'][number]): NativePage {
  const id = /(?:^|[ /])([a-f\d]{32})\.md$/i.exec(page.fileName)?.[1];
  if (!id)
    throw new Error(
      'Notion roster requires an original page identifier in every Markdown filename.',
    );
  const lines = page.contents.replace(/^\uFEFF/, '').split(/\r?\n/);
  const title = lines[0];
  if (!title?.startsWith('# ')) throw new Error('Notion roster Markdown title is missing.');
  const fields: Record<string, string> = { Name: title.slice(2) };
  let started = false;
  for (const line of lines.slice(1)) {
    if (!line && started) break;
    if (!line) continue;
    const divider = line.indexOf(': ');
    if (divider < 0) throw new Error('Notion roster Markdown properties are invalid.');
    const key = line.slice(0, divider);
    if (!COLUMNS.includes(key))
      throw new Error('Notion roster Markdown has unsupported properties.');
    if (Object.hasOwn(fields, key))
      throw new Error('Notion roster Markdown has duplicate properties.');
    fields[key] = line.slice(divider + 2);
    started = true;
  }
  const prefix = `- ${NOTION_NEWSLETTER_QUESTION}: `;
  const answers = lines
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length));
  return {
    id: id.toLowerCase().replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'),
    fields,
    answer: answers.length === 1 ? (answers[0] ?? null) : null,
  };
}
function sourceCsv(contents: string) {
  try {
    return parseRosterCsv(contents);
  } catch (error) {
    throw new Error('Notion roster source CSV is invalid.', { cause: error });
  }
}
function nativeRows(contents: string) {
  const rows = sourceCsv(contents),
    columns = Object.keys(rows[0] ?? {});
  if (
    columns.some((column) => !COLUMNS.includes(column)) ||
    COLUMNS.some((column) => !columns.includes(column))
  )
    throw new Error('Notion roster CSV must retain its original supported columns.');
  return rows;
}
const mappingKey = (fields: Record<string, string>) =>
  JSON.stringify([fields.Name, fields.Email, fields['Submitted at']]);
function minuteKey(email: string, calendar: Calendar) {
  return JSON.stringify([email, ...calendar.slice(0, 5)]);
}
function googleGroups(contents?: string) {
  const groups = new Map<string, Array<Record<string, string>>>();
  if (contents === undefined) return groups;
  const rows = sourceCsv(contents);
  if (
    rows.length &&
    ['Timestamp', 'Email Address'].some((key) => !Object.hasOwn(rows[0] ?? {}, key))
  )
    throw new Error('Notion roster original Google response columns are missing.');
  for (const row of rows) {
    const calendar = googleCalendar(row.Timestamp ?? '');
    if (!calendar) continue;
    const key = minuteKey(row['Email Address'] ?? '', calendar);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}
function formRecord(
  row: Record<string, string>,
  page: NativePage,
  context: {
    google: Record<string, string> | null;
    precise: string | null;
    display: DisplayMinute | null;
    zone: string | undefined;
  },
) {
  const { google, precise, display, zone } = context;
  return {
    submittedAt: precise,
    submissionMinute: submissionMinute(display),
    sourceSubmittedAt: row['Submitted at'] ?? null,
    originalResponseTimestamp: google?.Timestamp ?? null,
    originalResponseTimeZone: google ? (zone ?? null) : null,
    membershipAffirmative: null,
    affirmativeAnswer: page.answer,
    discordUsername: row.Discord === '' ? null : (row.Discord ?? null),
    fullName: row.Name ?? null,
    source: row.Source ?? null,
    ...(row['Response ID'] ? { responseId: row['Response ID'] } : {}),
    ...(row['Raw response'] ? { rawResponseUrl: row['Raw response'] } : {}),
  };
}
function normalizeRecord(
  row: Record<string, string>,
  page: NativePage,
  google: Record<string, string> | null,
  zone?: string,
): RosterImportRecord {
  const display = displayMinute(row['Submitted at'] ?? '');
  const precise = preciseSubmission(google, display, zone);
  const originalAnswer = google?.[NOTION_NEWSLETTER_QUESTION] ?? page.answer;
  const affirmative =
    precise !== null && google?.[NOTION_NEWSLETTER_QUESTION] === 'Yes' && page.answer === 'Yes';
  return {
    source: 'notion_intake',
    sourceId: page.id,
    email: row.Email ?? '',
    newsletter: {
      state: affirmative ? 'active' : 'unknown',
      affirmative,
      givenAt: affirmative ? precise : null,
      method: 'unknown',
      wordingVersion: null,
      wording: google || page.answer ? NOTION_NEWSLETTER_QUESTION : null,
      answer: originalAnswer === '' ? null : originalAnswer,
      evidenceReference: google
        ? 'notion native CSV and Markdown; original Google response CSV'
        : 'notion native CSV and Markdown',
    },
    form: formRecord(row, page, { google, precise, display, zone }),
  };
}

/** Correlate original source records without inferring consent from a Notion date or name. */
export function normalizeNotionRoster(input: NotionRosterSource): RosterImportRecord[] {
  if (input.googleTimeZone !== undefined && input.googleTimeZone !== 'America/Los_Angeles')
    throw new Error('Notion roster requires the documented original Google response timezone.');
  const rows = nativeRows(input.csv),
    pages = input.pages.map(nativePage);
  if (!rows.length || rows.length !== pages.length)
    throw new Error('Notion roster CSV and Markdown page counts must match.');
  if (new Set(pages.map((page) => page.id)).size !== pages.length)
    throw new Error('Notion roster has duplicate page identifiers.');
  const byNativeKey = new Map<string, NativePage[]>(),
    minuteCounts = new Map<string, number>();
  for (const page of pages) {
    const key = mappingKey(page.fields);
    byNativeKey.set(key, [...(byNativeKey.get(key) ?? []), page]);
  }
  for (const row of rows) {
    const display = displayMinute(row['Submitted at'] ?? '');
    if (display) {
      const key = minuteKey(row.Email ?? '', display.calendar);
      minuteCounts.set(key, (minuteCounts.get(key) ?? 0) + 1);
    }
  }
  const originals = googleGroups(input.googleCsv),
    consumed = new Set<string>();
  return rows.map((row) => {
    const matches = byNativeKey.get(mappingKey(row)) ?? [],
      page = matches[0];
    if (matches.length !== 1 || !page || consumed.has(page.id))
      throw new Error('Notion roster page mapping must be unique.');
    if (COLUMNS.some((key) => (row[key] ?? '') !== (page.fields[key] ?? '')))
      throw new Error('Notion roster CSV and Markdown properties do not match.');
    consumed.add(page.id);
    const display = displayMinute(row['Submitted at'] ?? '');
    const key = display ? minuteKey(row.Email ?? '', display.calendar) : '';
    const candidates = originals.get(key) ?? [];
    const google =
      candidates.length === 1 && minuteCounts.get(key) === 1 ? (candidates[0] ?? null) : null;
    return normalizeRecord(row, page, google, input.googleTimeZone);
  });
}
