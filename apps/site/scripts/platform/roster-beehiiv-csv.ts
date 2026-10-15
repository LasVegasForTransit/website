import type { RosterImportRecord } from '../../platform/roster-import';

export const BEEHIIV_ROSTER_COLUMNS = [
  'subscriber_id',
  'api_subscription_id',
  'email',
  'tags',
  'status',
  'created_at',
  'updated_at',
  'unsubscribed_at',
  'stripe_customer_id',
  'referred_by',
  'campaign',
  'channel',
  'acquisition_source',
  'referring_url',
  'acquisition_term',
  'acquisition_content',
  'device_type',
  'total_revenue_cents',
  'referral_count',
  'total_sent',
  'total_delivered',
  'total_unique_opened',
  'total_clicked',
  'total_unique_clicked',
  'open_rate',
  'click_rate',
  'last_opened_at',
  'last_clicked_at',
  'Free Tier',
  'First Name',
  'Last Name',
] as const;

class CsvSource {
  private rows: string[][] = [];
  private row: string[] = [];
  private value = '';
  private quoted = false;
  private closed = false;

  private field() {
    this.row.push(this.value);
    this.value = '';
    this.closed = false;
  }
  private endRow() {
    this.field();
    this.rows.push(this.row);
    this.row = [];
    if (this.rows.length > 10_001) throw new Error('Roster CSV exceeds the row limit.');
  }
  private readQuoted(character: string, next: string) {
    if (character === '"' && next === '"') {
      this.value += '"';
      return true;
    }
    if (character === '"') {
      this.quoted = false;
      this.closed = true;
    } else this.value += character;
    return false;
  }
  private readUnquoted(character: string, next: string) {
    if (character === ',') this.field();
    else if (character === '\r' || character === '\n') {
      this.endRow();
      return character === '\r' && next === '\n';
    } else if (character === '"' && !this.value && !this.closed) this.quoted = true;
    else if (character === '"' || this.closed)
      throw new Error(`Roster CSV has invalid quoting at row ${this.rows.length + 1}.`);
    else this.value += character;
    return false;
  }
  consume(character: string, next: string) {
    return this.quoted ? this.readQuoted(character, next) : this.readUnquoted(character, next);
  }
  finish() {
    if (this.quoted)
      throw new Error(`Roster CSV has an unclosed quoted field at row ${this.rows.length + 1}.`);
    if (this.value || this.row.length || this.closed) this.endRow();
    return this.rows;
  }
}

/** Parse source CSV without trimming, evaluating cells or guessing scalar types. */
export function parseRosterCsv(contents: string): Array<Record<string, string>> {
  if (new TextEncoder().encode(contents).length > 16 * 1024 * 1024)
    throw new Error('Roster CSV exceeds the input size limit.');
  const input = contents.replace(/^\uFEFF/, '');
  const source = new CsvSource();
  for (let index = 0; index < input.length; index++) {
    if (source.consume(input.charAt(index), input.charAt(index + 1))) index++;
  }
  const rows = source.finish();
  const headers = rows.shift();
  if (!headers?.length || headers.some((header) => !header.trim()))
    throw new Error('Roster CSV requires a nonempty header row.');
  if (new Set(headers).size !== headers.length)
    throw new Error('Roster CSV has duplicate headers.');
  return rows.map((cells, index) => {
    if (cells.length !== headers.length)
      throw new Error(`Roster CSV has a column count mismatch at row ${index + 2}.`);
    return Object.fromEntries(headers.map((header, column) => [header, cells[column] ?? '']));
  });
}

/** Only these explicitly UTC source formats establish an instant; calendar rollover is invalid. */
function utcTimestamp(value: string): string | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) UTC$/.exec(value) ??
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  date.setUTCHours(
    Number(hour),
    Number(minute),
    Number(second),
    Number((fraction ?? '').padEnd(3, '0')),
  );
  const actual = [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  ];
  return parts.every((part, index) => part === actual[index]) ? date.toISOString() : null;
}

function sourceName(value: string | undefined): string | null {
  return value === '' ? null : (value ?? null);
}

/** Preserve source facts; this export contains no proof of an affirmative newsletter choice. */
export function normalizeBeehiivCsv(contents: string, observedAt: string): RosterImportRecord[] {
  const observation = utcTimestamp(observedAt);
  if (!observation) throw new Error('Beehiiv CSV requires a precise UTC observation time.');
  let rows: Array<Record<string, string>>;
  try {
    rows = parseRosterCsv(contents);
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message.startsWith('Roster CSV ')
        ? error.message.replace(/^Roster CSV /, 'Beehiiv CSV ')
        : 'Beehiiv CSV could not be parsed.',
      { cause: error },
    );
  }
  const columns = Object.keys(rows[0] ?? {});
  if (!rows.length) throw new Error('Beehiiv CSV has no subscriber rows.');
  if (['api_subscription_id', 'email', 'status'].some((column) => !columns.includes(column)))
    throw new Error('Beehiiv CSV is missing required subscription, email or status columns.');
  if (
    columns.some(
      (column) =>
        !BEEHIIV_ROSTER_COLUMNS.includes(column as (typeof BEEHIIV_ROSTER_COLUMNS)[number]),
    )
  )
    throw new Error('Beehiiv CSV has unsupported columns.');
  return rows.map((source, index) => {
    if (
      Object.values(source).some((value) => value.length > 2000) ||
      new TextEncoder().encode(JSON.stringify(source)).length > 32 * 1024
    )
      throw new Error(`Beehiiv CSV exceeds the source field size limit at row ${index + 2}.`);
    const sourceId = source.api_subscription_id ?? '';
    if (sourceId.length === 0 || sourceId.trim() !== sourceId || sourceId.length > 200)
      throw new Error(`Beehiiv CSV requires a valid stable subscription id at row ${index + 2}.`);
    const withdrawnAt = utcTimestamp(source.unsubscribed_at ?? '');
    return {
      source: 'beehiiv',
      sourceId,
      email: source.email ?? '',
      givenName: sourceName(source['First Name']),
      familyName: sourceName(source['Last Name']),
      beehiiv: source,
      newsletter: {
        state: source.status === 'active' ? 'active' : withdrawnAt ? 'withdrawn' : 'unknown',
        givenAt: null,
        affirmative: false,
        method: 'unknown',
        wordingVersion: null,
        withdrawnAt,
        withdrawnTimeBasis: withdrawnAt ? 'choice' : 'observed',
        observedAt: observation,
        sourceCreatedAt: utcTimestamp(source.created_at ?? ''),
        evidenceReference: 'beehiiv full subscriber export',
      },
    };
  });
}
