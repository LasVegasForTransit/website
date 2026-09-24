import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

export function parseEnvFile(filePath: string): Map<string, string> {
  const entries = new Map<string, string>();
  if (!existsSync(filePath)) return entries;

  const content = readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const entry = parseLine(line);
    if (entry) entries.set(entry.key, entry.value);
  }
  return entries;
}

function parseLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const eqIndex = trimmed.indexOf('=');
  if (eqIndex === -1) return null;
  const key = trimmed.slice(0, eqIndex).trim();
  let value = trimmed.slice(eqIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

/**
 * Set `updates` in an env file, keeping every other line as it is. Returns
 * true when the file changed. When every key already holds its value the file
 * is not touched at all: no write, no permission change.
 */
export function mergeEnvFile(filePath: string, updates: Map<string, string>): boolean {
  const exists = existsSync(filePath);
  const content = exists ? readFileSync(filePath, 'utf8') : '';

  const existingKeys = new Set<string>();
  const result: string[] = [];

  for (const line of content.split('\n')) {
    const entry = parseLine(line);
    if (!entry) {
      result.push(line);
      continue;
    }
    existingKeys.add(entry.key);
    const updatedValue = updates.get(entry.key);
    if (updatedValue === undefined || updatedValue === entry.value) {
      result.push(line);
    } else {
      result.push(`${entry.key}=${quoteEnvValue(updatedValue)}`);
    }
  }

  for (const [key, value] of updates) {
    if (!existingKeys.has(key)) {
      result.push(`${key}=${quoteEnvValue(value)}`);
    }
  }

  const next = result.join('\n');
  if (exists && next === content) return false;

  writeFileSync(filePath, next);
  // .env.local may carry credentials (CLOUDFLARE_API_TOKEN). The default
  // umask leaves new files world-readable on most systems; tighten to user-
  // only. writeFileSync's `mode` option only applies to file *creation*, so
  // we always chmod after the write to cover existing files too.
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Non-POSIX filesystem (e.g. Windows FAT). Best-effort.
  }
  return true;
}

function quoteEnvValue(value: string): string {
  if (
    value.includes(' ') ||
    value.includes('"') ||
    value.includes("'") ||
    value.includes('#') ||
    value.includes('\n')
  ) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}
