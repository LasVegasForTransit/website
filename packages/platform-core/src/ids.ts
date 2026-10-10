// Sortable unique identifiers (ULIDs): 26 characters, the first 10 encode the
// creation time, so records sort by when they were made without revealing how
// many exist. Format: https://github.com/ulid/spec

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeTime(time: number): string {
  let remaining = time;
  let out = '';
  for (let i = 0; i < 10; i += 1) {
    out = ALPHABET.charAt(remaining % 32) + out;
    remaining = Math.floor(remaining / 32);
  }
  return out;
}

function encodeRandom(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = '';
  for (const byte of bytes) out += ALPHABET.charAt(byte % 32);
  return out;
}

export function ulid(time: number = Date.now()): string {
  return encodeTime(time) + encodeRandom();
}

export function nowIso(): string {
  return new Date().toISOString();
}
