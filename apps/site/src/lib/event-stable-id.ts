const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/**
 * Derive a 10-character lowercase RFC 4648 base32 identifier from a calendar
 * occurrence ID's SHA-256 digest so permanent links survive title and date edits.
 */
export async function stableEventId(calendarOccurrenceId: string): Promise<string> {
  const bytes = new TextEncoder().encode(calendarOccurrenceId);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let output = '';
  let buffer = 0;
  let bits = 0;

  for (const byte of digest) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(buffer >>> bits) & 31] ?? '';
      if (output.length === 10) return output;
    }
  }
  return output;
}
