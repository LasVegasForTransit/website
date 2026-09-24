/**
 * Everything the bootstrap does to the outside world goes through one
 * replaceable runtime: shell commands, secret writes, HTTP calls, DNS lookups,
 * prompts and the browser opener. Production uses the process runtime (real
 * subprocesses, real network, clack prompts). Tests install a fake runtime
 * with `withRuntime` and run the whole bootstrap against it.
 */

import type { CommandResult } from './types.js';
import { createProcessRuntime } from './process-runtime.js';

export type StreamKind = 'stdout' | 'stderr';

export interface CommandOptions {
  cwd?: string;
}

export interface StreamingCommandOptions extends CommandOptions {
  /** Called per line of stdout/stderr, with ANSI codes already stripped. */
  onLine?: (line: string, stream: StreamKind) => void;
}

export type PromptValidator = (value: string | undefined) => string | undefined;

/**
 * `id` names what a prompt asks for (a secret or env var name, or a short
 * `phase.question` key). The terminal never shows it; tests answer by it.
 */
interface PromptBase {
  id: string;
  message: string;
}

export interface ConfirmPrompt extends PromptBase {
  initialValue: boolean;
}

export interface TextPrompt extends PromptBase {
  placeholder?: string;
  defaultValue?: string;
  validate?: PromptValidator;
}

export interface PasswordPrompt extends PromptBase {
  validate?: PromptValidator;
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export interface SelectPrompt<T extends string> extends PromptBase {
  options: readonly ChoiceOption<T>[];
  initialValue?: T;
}

export interface Prompts {
  confirm(prompt: ConfirmPrompt): Promise<boolean>;
  /** Returns the typed text, or `defaultValue` (or '') when left empty. */
  text(prompt: TextPrompt): Promise<string>;
  /** Hidden input for secrets. Returns '' when left empty. */
  password(prompt: PasswordPrompt): Promise<string>;
  select<T extends string>(prompt: SelectPrompt<T>): Promise<T>;
}

export interface BootstrapRuntime {
  run(command: string, options?: CommandOptions): CommandResult;
  runInteractive(command: string, options?: CommandOptions): boolean;
  runStreaming(command: string, options?: StreamingCommandOptions): Promise<CommandResult>;
  /** Runs a command with `input` on stdin, so a secret never appears in argv or a log. */
  runWithInput(command: string, input: string, options?: CommandOptions): CommandResult;
  fetch: typeof globalThis.fetch;
  prompts: Prompts;
  resolve4(host: string): Promise<string[]>;
  resolveNs(host: string): Promise<string[]>;
  /** Opens a URL in the default browser; false when no opener is available. */
  openUrl(url: string): boolean;
  /** Wrangler's saved OAuth token from `wrangler login`, or null. */
  wranglerOAuthToken(): string | null;
  /** True when a person is at the terminal (stdout is a TTY). */
  isInteractive(): boolean;
  sleep(ms: number): Promise<void>;
}

let active: BootstrapRuntime | null = null;

/** The runtime every phase and helper uses. */
export function rt(): BootstrapRuntime {
  active ??= createProcessRuntime();
  return active;
}

/** Run `fn` with `runtime` installed, then restore the previous one. */
export async function withRuntime<T>(runtime: BootstrapRuntime, fn: () => Promise<T>): Promise<T> {
  const previous = active;
  active = runtime;
  try {
    return await fn();
  } finally {
    active = previous;
  }
}
