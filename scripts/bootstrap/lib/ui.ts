import { cancel, confirm, isCancel, note } from '@clack/prompts';
import pc from 'picocolors';

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

export async function promptOrExit<T>(
  promise: Promise<T>,
  cancelMessage = 'Bootstrap cancelled.',
): Promise<T> {
  const result = await promise;
  if (isCancel(result)) {
    cancel(cancelMessage);
    process.exit(1);
  }
  return result;
}

export async function promptConfirm(
  message: string,
  initialValue: boolean,
  cancelMessage?: string,
): Promise<boolean> {
  const result = await promptOrExit(confirm({ message, initialValue }), cancelMessage);
  return result === true;
}
