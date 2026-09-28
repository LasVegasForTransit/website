import { note } from '@clack/prompts';
import pc from 'picocolors';
import { rt } from './runtime.js';

export function logSubline(message: string): void {
  process.stdout.write(`${pc.gray('│')}  ${message}\n`);
}

export type ToolRowStatus = 'ready' | 'failed' | 'deferred' | 'skipped' | 'pending';

export interface ToolRow {
  label: string;
  status: ToolRowStatus;
  detail?: string;
}

const STATUS_GLYPH: Record<ToolRowStatus, string> = {
  ready: pc.green('✔'),
  failed: pc.red('✖'),
  deferred: pc.yellow('—'),
  skipped: pc.dim('·'),
  pending: pc.dim('?'),
};

export function printToolTable(title: string, rows: ToolRow[]): void {
  if (rows.length === 0) return;
  const labelWidth = Math.max(...rows.map((r) => r.label.length));
  const detailWidth = Math.max(0, ...rows.map((r) => (r.detail ?? '').length));
  const lines = rows.map((r) => {
    const detail = r.detail ?? '';
    return `${STATUS_GLYPH[r.status]}  ${r.label.padEnd(labelWidth)}  ${pc.dim(detail.padEnd(detailWidth))}`;
  });
  note(lines.join('\n'), title);
}

/** Yes/no question. `id` names the question for tests; the terminal never shows it. */
export async function promptConfirm(
  id: string,
  message: string,
  initialValue: boolean,
): Promise<boolean> {
  return rt().prompts.confirm({ id, message, initialValue });
}
