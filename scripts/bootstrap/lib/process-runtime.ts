import { spawn, spawnSync } from 'node:child_process';
import { promises as dns } from 'node:dns';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { cancel, confirm, isCancel, password, select, text } from '@clack/prompts';
import type { CommandResult } from './types.js';
import type {
  BootstrapRuntime,
  CommandOptions,
  Prompts,
  SelectPrompt,
  StreamingCommandOptions,
  StreamKind,
} from './runtime.js';

function resolveShell(): string {
  // Always /bin/sh — POSIX, no zshenv/zshrc/profile loading. Avoids the class
  // of bug where a user's shell init scripts (direnv, dotenv hooks, manual
  // export) re-inject env vars and undo our `subprocessEnv()` scrub.
  return '/bin/sh';
}

/**
 * Env vars that must NEVER reach subprocesses. The CF API token is only used
 * by direct fetch() calls in this bootstrap (see `cloudflare-api.ts`). It's
 * deliberately scoped to Zone.DNS:Edit only — handing it to wrangler would
 * (a) leak it to wrangler's logs/state, and (b) confuse wrangler into using
 * a token without Pages scope for Pages calls.
 */
const SUBPROCESS_ENV_DENYLIST: ReadonlySet<string> = new Set(['CLOUDFLARE_API_TOKEN']);

function subprocessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (SUBPROCESS_ENV_DENYLIST.has(key)) continue;
    env[key] = value;
  }
  return env;
}

function run(command: string, opts: CommandOptions = {}): CommandResult {
  const result = spawnSync(resolveShell(), ['-c', command], {
    stdio: 'pipe',
    encoding: 'utf8',
    cwd: opts.cwd,
    env: subprocessEnv(),
  });
  return { ok: result.status === 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function runWithInput(command: string, input: string, opts: CommandOptions = {}): CommandResult {
  const result = spawnSync(resolveShell(), ['-c', command], {
    cwd: opts.cwd,
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return { ok: result.status === 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function runInteractive(command: string, opts: CommandOptions = {}): boolean {
  const result = spawnSync(resolveShell(), ['-c', command], {
    stdio: 'inherit',
    env: subprocessEnv(),
    cwd: opts.cwd,
  });
  return result.status === 0;
}

/**
 * Spawn a long-running command and stream its output line-by-line. Used to
 * funnel subprocess output (e.g. `wrangler pages deploy`) into a clack
 * `taskLog` so it stays inside the TUI instead of spraying raw frames over
 * an active spinner.
 */
function runStreaming(command: string, opts: StreamingCommandOptions = {}): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(resolveShell(), ['-c', command], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: opts.cwd,
      env: subprocessEnv(),
    });

    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    let settled = false;
    const settle = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const tap = (stream: NodeJS.ReadableStream | null, kind: StreamKind, sink: string[]): void => {
      if (!stream) return;
      const rl = createInterface({ input: stream });
      rl.on('line', (line) => {
        const clean = stripAnsi(line);
        sink.push(clean);
        opts.onLine?.(clean, kind);
      });
      // Stream-level errors (rare: e.g. EPIPE) shouldn't hang the promise.
      stream.on('error', (err) => sink.push(`<stream error: ${(err as Error).message}>`));
    };

    tap(child.stdout, 'stdout', stdoutLines);
    tap(child.stderr, 'stderr', stderrLines);

    // Without this, a spawn failure (e.g. shell missing) leaves the promise
    // pending forever — `'close'` never fires when `spawn` itself errored.
    child.on('error', (err) => {
      settle({
        ok: false,
        stdout: stdoutLines.join('\n').trim(),
        stderr: err.message,
      });
    });

    child.on('close', (code) => {
      settle({
        ok: code === 0,
        stdout: stdoutLines.join('\n').trim(),
        stderr: stderrLines.join('\n').trim(),
      });
    });
  });
}

// Strip CSI escape sequences (color, cursor moves, erase) — wrangler emits
// all of them and they render as garbage inside a clack taskLog box. Matches
// every `\x1b[ ... <letter>` sequence, not just the SGR (`m`) subset.
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex -- ANSI sequences start with the ESC control character.
  return s.replace(/\x1b\[[\d;]*[a-zA-Z]/g, '');
}

/** POSIX-shell single-quote a string so it survives `sh -c '<cmd>'` interpolation. */
function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function openUrl(url: string): boolean {
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
  return run(`${opener} ${quote(url)}`).ok;
}

/**
 * Read wrangler's OAuth token from its on-disk config. The path varies by
 * wrangler version + OS; we try the known locations in order and parse the
 * minimal subset of TOML we need (just `oauth_token = "..."`). Returns null
 * if no non-expired token is found.
 */
function readWranglerOAuthToken(): string | null {
  const home = os.homedir();
  const candidates = [
    // eslint-disable-next-line turbo/no-undeclared-env-vars -- wrangler's own setting, read only to find its sign-in file.
    process.env.WRANGLER_HOME,
    path.join(home, 'Library', 'Preferences', '.wrangler'),
    path.join(home, '.config', '.wrangler'),
    path.join(home, '.wrangler'),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);

  for (const dir of candidates) {
    const filePath = path.join(dir, 'config', 'default.toml');
    if (!existsSync(filePath)) continue;
    try {
      const contents = readFileSync(filePath, 'utf8');
      const token = /^\s*oauth_token\s*=\s*"([^"]+)"/m.exec(contents)?.[1];
      if (!token) continue;

      const expiry = /^\s*expiration_time\s*=\s*"([^"]+)"/m.exec(contents)?.[1];
      if (expiry) {
        const exp = Date.parse(expiry);
        if (!Number.isNaN(exp) && exp <= Date.now()) {
          // Expired; another candidate may have a fresher token, keep looking.
          continue;
        }
      }
      return token;
    } catch {
      continue;
    }
  }
  return null;
}

async function orExit<T>(promise: Promise<T | symbol>): Promise<T> {
  const result = await promise;
  if (isCancel(result)) {
    cancel('Bootstrap cancelled.');
    process.exit(1);
  }
  return result;
}

const clackPrompts: Prompts = {
  async confirm({ message, initialValue }) {
    return orExit(confirm({ message, initialValue }));
  },
  async text({ message, placeholder, defaultValue, validate }) {
    const value = await orExit(text({ message, placeholder, defaultValue, validate }));
    return typeof value === 'string' ? value : '';
  },
  async password({ message, validate }) {
    const value = await orExit(password({ message, validate }));
    return typeof value === 'string' ? value : '';
  },
  async select<T extends string>({ message, options, initialValue }: SelectPrompt<T>) {
    const choices = options.map((o) => ({ value: o.value, label: o.label, hint: o.hint }));
    return (await orExit(select<string>({ message, options: choices, initialValue }))) as T;
  },
};

async function safeDns(lookup: () => Promise<string[]>): Promise<string[]> {
  try {
    return await lookup();
  } catch {
    return [];
  }
}

export function createProcessRuntime(): BootstrapRuntime {
  return {
    run,
    runInteractive,
    runStreaming,
    runWithInput,
    fetch: (input, init) => globalThis.fetch(input, init),
    prompts: clackPrompts,
    resolve4: (host) => safeDns(() => dns.resolve4(host)),
    resolveNs: (host) => safeDns(() => dns.resolveNs(host)),
    openUrl,
    wranglerOAuthToken: readWranglerOAuthToken,
    isInteractive: () => process.stdout.isTTY,
    sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  };
}
