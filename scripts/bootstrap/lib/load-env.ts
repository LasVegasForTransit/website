import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseEnvFile } from './env-file.js';

/**
 * Hydrate process.env from `.env.local` so persistent choices made by earlier
 * phases (e.g. `CLOUDFLARE_ACCOUNT_ID` chosen in deploy) are visible to later
 * subprocess calls — including subsequent runs of the bootstrap CLI.
 *
 * We only fill values that aren't already set in the parent process env, so
 * shell-exported overrides always win.
 */
export function loadEnvLocal(projectRoot: string): void {
  const filePath = path.join(projectRoot, '.env.local');
  if (!existsSync(filePath)) return;
  const entries = parseEnvFile(filePath);
  for (const [key, value] of entries) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
