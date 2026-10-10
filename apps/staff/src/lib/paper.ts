import {
  MAX_PAPER_ROWS,
  emptyPaperRow,
  type PaperInput,
  type PaperErrors,
} from '@lasvegasfortransit/platform-core/paper';
import { digestToken } from '@lasvegasfortransit/platform-core/random-token';
import { consumeFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import { importPaperBatch } from '@lasvegasfortransit/platform-storage/paper-intake';
import type { StaffContext } from './context';
import { field } from './forms';
import { messageResponse } from './responses';
export interface PaperFeedback {
  input: PaperInput;
  errors: PaperErrors;
  status: number;
  message?: string;
}
export const PAPER_FIELDS = [
  { name: 'givenName', label: 'First name', limit: 128, type: 'text' },
  { name: 'familyName', label: 'Last name', limit: 128, type: 'text' },
  { name: 'email', label: 'Email', limit: 254, type: 'email' },
  { name: 'phone', label: 'Phone', limit: 50, type: 'tel' },
] as const;
export function initialPaper(batchId: string): PaperInput {
  return {
    batchId,
    eventId: '',
    eventName: '',
    eventDate: '',
    wordingVersion: '',
    rows: Array.from({ length: 5 }, emptyPaperRow),
  };
}
async function readPaper(form: FormData): Promise<PaperInput> {
  const eventName = field(form, 'event_name', 161),
    eventDate = field(form, 'event_date', 30);
  const raw = Number(field(form, 'row_count', 4)),
    count = Number.isInteger(raw) ? Math.max(1, Math.min(MAX_PAPER_ROWS, raw)) : 5;
  const rows = Array.from({ length: count }, (_, index) => ({
    givenName: field(form, `rows.${index}.givenName`, 129),
    familyName: field(form, `rows.${index}.familyName`, 129),
    email: field(form, `rows.${index}.email`, 255),
    phone: field(form, `rows.${index}.phone`, 51),
    newsletterConsent: form.get(`rows.${index}.newsletterConsent`) === 'on',
  }));
  const eventId = `paper:${await digestToken(JSON.stringify({ name: eventName.trim().toLowerCase(), date: eventDate }))}`;
  return {
    batchId: field(form, 'batch_id', 101),
    eventId,
    eventName,
    eventDate,
    wordingVersion: field(form, 'wording_version', 100),
    rows,
  };
}
export async function submitPaper(
  request: Request,
  staff: StaffContext,
): Promise<PaperFeedback | Response> {
  const form = await request.formData(),
    input = await readPaper(form);
  if (
    !(await consumeFormToken(staff.db, staff.actor, {
      action: 'paper:submit',
      token: field(form, 'token', 43),
    }))
  )
    return {
      input,
      errors: {},
      status: 409,
      message:
        'This form expired or was already submitted. Your entries are still here; check them and try again.',
    };
  if (form.get('intent') === 'add') {
    if (input.rows.length < MAX_PAPER_ROWS) input.rows.push(emptyPaperRow());
    return { input, errors: {}, status: 200 };
  }
  try {
    const result = await importPaperBatch(staff.db, staff.actor, input);
    if (result.kind === 'ok')
      return new Response(null, {
        status: 303,
        headers: { Location: `/paper/?saved=${encodeURIComponent(input.batchId)}` },
      });
    if (result.kind === 'forbidden') return messageResponse("You don't have access to this", 403);
    if (result.kind === 'invalid')
      return {
        input,
        errors: result.errors,
        status: 400,
        message: 'Check the marked entries. Nothing has been saved yet.',
      };
    return {
      input,
      errors: {},
      status: 409,
      message:
        'This sheet may already have been recorded, or a matching record changed. Your entries are still here. Check before trying again.',
    };
  } catch {
    return {
      input,
      errors: {},
      status: 503,
      message: 'We couldn’t save this sheet. Your entries are still here; please try again.',
    };
  }
}
