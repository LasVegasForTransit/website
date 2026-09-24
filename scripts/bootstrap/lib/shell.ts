import type { CommandResult } from './types.js';
import { rt, type CommandOptions, type StreamingCommandOptions } from './runtime.js';

export type { StreamKind } from './runtime.js';
export type ShellOptions = CommandOptions;

export function runCommand(command: string, opts: ShellOptions = {}): CommandResult {
  return rt().run(command, opts);
}

export function commandOutput(result: CommandResult): string {
  if (result.stdout.length > 0) return result.stdout;
  if (result.stderr.length > 0) return result.stderr;
  return 'no output';
}

/**
 * First line of `s`, trimmed, optionally truncated to `maxLen` with an
 * ellipsis. Useful for compressing long subprocess output or stack-trace-
 * style error messages into a single readable summary.
 */
export function firstLine(s: string, maxLen?: number): string {
  const nl = s.indexOf('\n');
  const head = (nl === -1 ? s : s.slice(0, nl)).trim();
  if (maxLen === undefined || head.length <= maxLen) return head;
  return `${head.slice(0, maxLen - 3)}...`;
}

export function summarizeOutputLine(result: CommandResult): string {
  return firstLine(commandOutput(result));
}

export function runInteractiveCommand(command: string, opts: ShellOptions = {}): boolean {
  return rt().runInteractive(command, opts);
}

/**
 * Run a long-running command and stream its output line-by-line. Used to
 * funnel subprocess output (e.g. `wrangler pages deploy`) into a clack
 * `taskLog` so it stays inside the TUI instead of spraying raw frames over
 * an active spinner.
 */
export function runStreamingCommand(
  command: string,
  opts: StreamingCommandOptions = {},
): Promise<CommandResult> {
  return rt().runStreaming(command, opts);
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
  return rt().openUrl(url);
}
