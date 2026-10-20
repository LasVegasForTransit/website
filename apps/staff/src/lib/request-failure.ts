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
export function requestFailure(error: unknown, layer: 'gateway' | 'middleware'): Response {
  const report = createStaffErrorReport();
  // Exception messages can contain SQL, contact details and provider responses.
  console.error('staff_request_failed', {
    layer,
    category: staffFailureCategory(error),
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
