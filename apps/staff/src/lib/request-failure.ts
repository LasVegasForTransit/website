import { createStaffErrorReport, readStaffErrorReport, messageResponse } from './responses';

export function staffFailureCategory(
  error: unknown,
): 'database_read_limit' | 'database_write_limit' | 'unexpected' {
  let cause = error;
  for (let depth = 0; depth < 5 && cause instanceof Error; depth++) {
    if (
      /account has exceeded D1['’]s (?:free tier daily row read|maximum daily rows? read) limit/i.test(
        cause.message,
      )
    )
      return 'database_read_limit';
    if (
      /account has exceeded D1['’]s (?:free tier daily row write|maximum daily rows? written) limit/i.test(
        cause.message,
      )
    )
      return 'database_write_limit';
    cause = cause.cause;
  }
  return 'unexpected';
}
const safeErrorNames = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'AggregateError',
]);
function databaseFailureCause(error: Error): string | undefined {
  if (/^(?:D1_ERROR:\s*)?no such table:/i.test(error.message)) return 'missing_table';
  if (/^(?:D1_ERROR:\s*)?no such column:/i.test(error.message)) return 'missing_column';
  return undefined;
}
function failureCodeLocations(error: Error): string[] {
  if (error.message.length > 4096) return [];
  const stack = error.stack;
  const prefix = `${error.name}${error.message ? ': ' + error.message : ''}`;
  // Remove the whole message, including injected newlines, before reading code locations.
  if (!stack?.startsWith(prefix)) return [];
  return stack
    .slice(prefix.length, prefix.length + 8192)
    .split('\n')
    .flatMap((line) => {
      const frame =
        /^\s*at .*(?:\/|\(|\s)([A-Za-z_][A-Za-z0-9_.-]{0,95}\.(?:mjs|cjs|js|ts|astro)):(\d{1,7}):(\d{1,7})\)?\s*$/.exec(
          line,
        );
      return frame ? [`${frame[1]}:${frame[2]}:${frame[3]}`] : [];
    })
    .slice(0, 6);
}
function staffFailureDiagnostics(
  error: unknown,
  category: ReturnType<typeof staffFailureCategory>,
) {
  const frames = new Set<string>();
  const errorType =
    error instanceof Error && safeErrorNames.has(error.name) ? error.name : 'unknown';
  let causeCode: string = category === 'unexpected' ? 'unclassified' : category;
  let cause = error;
  for (let depth = 0; depth < 5 && cause instanceof Error; depth++) {
    if (causeCode === 'unclassified') causeCode = databaseFailureCause(cause) ?? causeCode;
    for (const frame of failureCodeLocations(cause)) {
      if (frames.size < 6) frames.add(frame);
    }
    cause = cause.cause;
  }
  return { errorType, causeCode, frames: [...frames] };
}

export function requestFailure(error: unknown, layer: 'gateway' | 'middleware'): Response {
  const report = createStaffErrorReport();
  // Exception messages can contain SQL, contact details and provider responses.
  const category = staffFailureCategory(error);
  console.error({
    event: 'staff_request_failed',
    layer,
    category,
    diagnostics: staffFailureDiagnostics(error, category),
    requestId: report.reference,
    occurredAt: report.occurredAt,
  });
  return messageResponse('', 503, 'home', report);
}
export function recoverStaffResponse(response: Response): Response {
  if (response.status >= 500 || response.status === 404) {
    void response.body?.cancel().catch(() => undefined);
    return messageResponse('', response.status, 'home', readStaffErrorReport(response));
  }
  return response;
}
