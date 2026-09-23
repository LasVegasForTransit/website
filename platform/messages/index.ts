// The message catalog: every member-facing string, looked up by key. Runs on
// the server and at build time only, so it adds no JavaScript to pages.
// `en` is the only published language. `en-XA` is a pseudo-language for
// testing layouts with longer text; it is never served on production.

import { en } from './en';

export type Locale = 'en' | 'en-XA';

interface PluralForms {
  readonly one: string;
  readonly other: string;
}
type Message = string | PluralForms;

type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string | PluralForms
    ? `${Prefix}${K}`
    : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<typeof en>;
export type MessageValues = Record<string, string | number>;

export const TIME_ZONE = 'America/Los_Angeles';

function lookup(catalog: unknown, key: string): Message | undefined {
  let node: unknown = catalog;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node === 'string') return node;
  if (typeof node === 'object' && node !== null && 'other' in node) return node as PluralForms;
  return undefined;
}

function fill(text: string, values: MessageValues): string {
  return text.replaceAll(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

const ACCENTS: Record<string, string> = {
  a: 'à',
  c: 'ċ',
  e: 'é',
  g: 'ĝ',
  h: 'ĥ',
  i: 'ï',
  n: 'ñ',
  o: 'ö',
  s: 'š',
  t: 'ţ',
  u: 'û',
  y: 'ý',
};

/** About 40 percent longer, with accents, keeping `{value}` placeholders intact. */
export function pseudoLocalize(text: string): string {
  const accented = text.replaceAll(/\{\w+\}|[a-z]/g, (part) => ACCENTS[part] ?? part);
  const padding = ' ·'.repeat(Math.ceil(text.length * 0.2));
  return `[${accented}${padding}]`;
}

/**
 * A lookup function for one catalog and locale. Tests pass their own
 * catalog; the site uses `t`.
 */
export function createTranslator(catalog: unknown, locale: Locale = 'en') {
  const plurals = new Intl.PluralRules('en');
  return (key: string, values: MessageValues = {}): string => {
    const message = lookup(catalog, key);
    if (message === undefined) throw new Error(`Missing message: ${key}`);
    let text: string;
    if (typeof message === 'string') {
      text = message;
    } else {
      const count = 'count' in values ? Number(values.count) : 0;
      text = plurals.select(count) === 'one' ? message.one : message.other;
    }
    const filled = fill(text, values);
    return locale === 'en-XA' ? pseudoLocalize(filled) : filled;
  };
}

/**
 * The language pages are built in. `en-XA` only when LVBT_PSEUDO_LOCALE=1 is
 * set for a build, which the audit's long-text check does; production never
 * sets it, and its deploy fails if a page says lang="en-XA".
 */
export const LOCALE: Locale =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.LVBT_PSEUDO_LOCALE === '1'
    ? 'en-XA'
    : 'en';

const translate = createTranslator(en, LOCALE);

export function t(key: MessageKey, values?: MessageValues): string {
  return translate(key, values);
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/** A date with its year, like "Oct 5, 2026". */
export function formatFullDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(date)
    .replace('AM', 'am')
    .replace('PM', 'pm');
}

export { en };
