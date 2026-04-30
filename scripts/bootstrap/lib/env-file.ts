import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

export function parseEnvFile(filePath: string): Map<string, string> {
  const entries = new Map<string, string>();
  if (!existsSync(filePath)) return entries;

  const content = readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries.set(key, value);
  }
  return entries;
}

export function mergeEnvFile(filePath: string, updates: Map<string, string>): void {
  let content = '';
  if (existsSync(filePath)) {
    content = readFileSync(filePath, 'utf8');
  }

  const existingKeys = new Set<string>();
  const lines = content.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      result.push(line);
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      result.push(line);
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    existingKeys.add(key);
    if (updates.has(key)) {
      const updatedValue = updates.get(key);
      if (updatedValue !== undefined) {
        result.push(`${key}=${quoteEnvValue(updatedValue)}`);
      }
    } else {
      result.push(line);
    }
  }

  for (const [key, value] of updates) {
    if (!existingKeys.has(key)) {
      result.push(`${key}=${quoteEnvValue(value)}`);
    }
  }

  writeFileSync(filePath, result.join('\n'));
  // .env.local may carry credentials (CLOUDFLARE_API_TOKEN). The default
  // umask leaves new files world-readable on most systems; tighten to user-
  // only. writeFileSync's `mode` option only applies to file *creation*, so
  // we always chmod after the write to cover existing files too.
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Non-POSIX filesystem (e.g. Windows FAT). Best-effort.
  }
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
