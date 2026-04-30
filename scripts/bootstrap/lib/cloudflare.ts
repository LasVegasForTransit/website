import path from 'node:path';
import { log, select } from '@clack/prompts';
import { runCommand, runInteractiveCommand } from './shell.js';
import { mergeEnvFile } from './env-file.js';
import { promptOrExit } from './ui.js';

export interface CloudflareAccount {
  id: string;
  name: string;
}

export interface AccountResolution {
  ok: boolean;
  accountId?: string;
  /** When the resolution failed and we have nothing actionable, the raw whoami output. */
  raw?: string;
}

const SWITCH_USERS = '__lvbt_switch_wrangler_users__';

/**
 * Make sure `process.env.CLOUDFLARE_ACCOUNT_ID` is populated and the user has
 * confirmed it before we run any wrangler command that hits the Cloudflare
 * API.
 *
 * Strategy:
 *   - Non-TTY (CI) AND env var set → trust silently (no terminal to prompt
 *     into). This is the ONLY auto-skip path — interactive runs always show
 *     the picker, every call, no in-process caching.
 *   - Otherwise → run `wrangler whoami`, show a `select` of every account in
 *     the table plus a "switch wrangler users" option (which runs
 *     `wrangler logout` + `wrangler login` in-session and recurses to re-list
 *     accounts under the new login).
 *
 * We never read wrangler error messages and pattern-match strings on them. We
 * only consume successful, structured-ish output (the whoami table) and rely
 * on exit codes to know when the table is unavailable.
 */
export async function ensureCloudflareAccount(projectRoot: string): Promise<AccountResolution> {
  if (!process.stdout.isTTY && process.env.CLOUDFLARE_ACCOUNT_ID?.trim()) {
    return { ok: true, accountId: process.env.CLOUDFLARE_ACCOUNT_ID.trim() };
  }

  const whoami = runCommand('wrangler whoami');
  if (!whoami.ok) {
    return { ok: false, raw: whoami.stderr || whoami.stdout };
  }

  const accounts = parseAccounts(whoami.stdout);
  if (accounts.length === 0) {
    // Couldn't parse a table — older wrangler, or single-account stub output.
    // Let wrangler's own account default ride; nothing to pick from here.
    return { ok: true };
  }

  const cached = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const initialValue = cached && accounts.some((a) => a.id === cached) ? cached : accounts[0]!.id;

  // Short id chunk in the label so the submitted prompt itself shows enough
  // for the user to verify (account name + first 8 chars of id) without us
  // having to dump the full 32-char id on a follow-up line that would wrap on
  // narrow terminals and trip up subsequent clack spinner rendering.
  const chosen = (await promptOrExit(
    select({
      message: 'Cloudflare account for this project:',
      options: [
        ...accounts.map((a) => ({
          value: a.id,
          label: `${a.name} · ${a.id.slice(0, 8)}`,
          hint: a.id,
        })),
        {
          value: SWITCH_USERS,
          label: 'Switch wrangler users (logout + login)',
          hint: 'use a different Cloudflare login entirely',
        },
      ],
      initialValue,
    }),
  )) as string;

  if (chosen === SWITCH_USERS) {
    const logoutOk = runInteractiveCommand('wrangler logout');
    if (!logoutOk) {
      log.warn(`wrangler logout reported an error — continuing anyway.`);
    }
    log.info(`Opening wrangler login… complete the OAuth flow in your browser, then return here.`);
    const loginOk = runInteractiveCommand('wrangler login');
    if (!loginOk) {
      log.error('wrangler login failed.');
      return { ok: false };
    }
    // Recurse so the next pass re-lists accounts under the new login.
    clearCloudflareAccount(projectRoot);
    return ensureCloudflareAccount(projectRoot);
  }

  process.env.CLOUDFLARE_ACCOUNT_ID = chosen;
  persistChoice(projectRoot, chosen);
  return { ok: true, accountId: chosen };
}

/**
 * Clear the cached account id, in-process and on disk. The next call to
 * `ensureCloudflareAccount` will re-prompt against whatever wrangler login
 * is currently active.
 */
export function clearCloudflareAccount(projectRoot: string): void {
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  persistChoice(projectRoot, '');
}

/**
 * Extract `{ name, id }` pairs from a `wrangler whoami` table.
 *
 * The whoami table renders rows like:
 *   │ Account Name      │ Account ID                       │
 *   │ Rebuilding America│ e34437d6da60fe58537bafc5eb760cfc │
 *
 * We anchor on the box-drawing pipe character (`│`) plus a 32-character
 * lowercase hex account id. Account ids are stable in format; box characters
 * are stable in wrangler's output. This is parsing structured layout, not
 * scraping error messages.
 */
function parseAccounts(stdout: string): CloudflareAccount[] {
  const rowRe = /│\s*([^│]+?)\s*│\s*([0-9a-f]{32})\s*│/g;
  const accounts: CloudflareAccount[] = [];
  for (const line of stdout.split('\n')) {
    rowRe.lastIndex = 0;
    const match = rowRe.exec(line);
    if (!match) continue;
    const name = match[1]!.trim();
    const id = match[2]!.trim();
    // Skip the header row (whose "id" cell is the literal text "Account ID").
    if (name.toLowerCase() === 'account name' || /^account\s*id$/i.test(id)) continue;
    accounts.push({ name, id });
  }
  return accounts;
}

function persistChoice(projectRoot: string, accountId: string): void {
  const target = path.join(projectRoot, '.env.local');
  mergeEnvFile(target, new Map([['CLOUDFLARE_ACCOUNT_ID', accountId]]));
}
