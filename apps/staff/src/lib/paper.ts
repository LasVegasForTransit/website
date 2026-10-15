import { t } from '@lasvegasfortransit/platform-core/messages';
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
  { name: 'givenName', label: t('staff.paper.firstName'), limit: 128, type: 'text' },
  { name: 'familyName', label: t('staff.paper.lastName'), limit: 128, type: 'text' },
  { name: 'email', label: t('staff.paper.email'), limit: 254, type: 'email' },
  { name: 'phone', label: t('staff.paper.phone'), limit: 50, type: 'tel' },
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
export interface PublicPaperEvent {
  id: string;
  title: string;
  date: Date;
}
async function readPaper(form: FormData, events: readonly PublicPaperEvent[]): Promise<PaperInput> {
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
  const selected = field(form, 'public_event', 513);
  const eventId = selected
    ? (events.find((event) => event.id === selected)?.id ?? '')
    : `paper:${await digestToken(JSON.stringify({ name: eventName.trim().toLowerCase(), date: eventDate }))}`;
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
  events: readonly PublicPaperEvent[] = [],
): Promise<PaperFeedback | Response> {
  const form = await request.formData(),
    input = await readPaper(form, events);
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
      message: t('staff.paper.expired'),
    };
  if (form.get('intent') === 'add') {
    input.rows.push(
      ...Array.from({ length: Math.min(5, MAX_PAPER_ROWS - input.rows.length) }, emptyPaperRow),
    );
    return { input, errors: {}, status: 200 };
  }
  try {
    const result = await importPaperBatch(staff.db, staff.actor, input);
    if (result.kind === 'ok')
      return new Response(null, {
        status: 303,
        headers: { Location: `/paper/?saved=${encodeURIComponent(input.batchId)}` },
      });
    if (result.kind === 'forbidden') return messageResponse(t('staff.common.accessDenied'), 403);
    if (result.kind === 'invalid')
      return {
        input,
        errors: result.errors,
        status: 400,
        message: t('staff.paper.invalid'),
      };
    return {
      input,
      errors: {},
      status: 409,
      message: t('staff.paper.conflict'),
    };
  } catch {
    return {
      input,
      errors: {},
      status: 503,
      message: t('staff.paper.unavailable'),
    };
  }
}
