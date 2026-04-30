import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { CommandResult } from './types.js';

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

export interface ShellOptions {
  cwd?: string;
}

export function runCommand(command: string, opts: ShellOptions = {}): CommandResult {
  const result = spawnSync(resolveShell(), ['-c', command], {
    stdio: 'pipe',
    encoding: 'utf8',
    cwd: opts.cwd,
    env: subprocessEnv(),
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

export function commandOutput(result: CommandResult): string {
  if (result.stdout.length > 0) return result.stdout;
  if (result.stderr.length > 0) return result.stderr;
  return 'no output';
}

export function summarizeOutputLine(result: CommandResult): string {
  return commandOutput(result).split('\n')[0]!.trim();
}

export function runInteractiveCommand(command: string, opts: ShellOptions = {}): boolean {
  const result = spawnSync(resolveShell(), ['-c', command], {
    stdio: 'inherit',
    env: subprocessEnv(),
    cwd: opts.cwd,
  });
  return result.status === 0;
}

export type StreamKind = 'stdout' | 'stderr';

export interface StreamingCommandOptions extends ShellOptions {
  /** Called per line of stdout/stderr, with ANSI codes already stripped. */
  onLine?: (line: string, stream: StreamKind) => void;
}

/**
 * Spawn a long-running command and stream its output line-by-line. Used to
 * funnel subprocess output (e.g. `wrangler pages deploy`) into a clack
 * `taskLog` so it stays inside the TUI instead of spraying raw frames over
 * an active spinner.
 */
export async function runStreamingCommand(
  command: string,
  opts: StreamingCommandOptions = {},
): Promise<CommandResult> {
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
        stderr: (err as Error).message,
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

// Minimal ANSI scrub — wrangler emits color codes that look ugly when
// re-rendered inside a clack taskLog box.
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

/** POSIX-shell single-quote a string so it survives `sh -c '<cmd>'` interpolation. */
export function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Best-effort cross-platform "open this URL in the user's default browser".
 * Returns false when no opener is available (e.g. headless SSH); caller should
 * fall back to printing the URL and letting the user click it themselves.
 */
export function tryOpenInBrowser(url: string): boolean {
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
  const r = runCommand(`${opener} ${shellEscape(url)}`);
  return r.ok;
}
