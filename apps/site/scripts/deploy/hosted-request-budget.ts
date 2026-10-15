import type { APIRequestContext, BrowserContext } from '@playwright/test';

export const HOSTED_REQUEST_LIMIT = 116;
export const HOSTED_ACCEPTANCE_LIMIT = 64;
export const CANDIDATE_SMOKE_LIMIT = 20;
export const ACTIVATED_SMOKE_LIMIT = 32;
export const ACTIVATION_MARKER_LIMIT = 5;
export const ACTIVATION_MARKER_WAIT_MS = 20_000;

export function createHostedRequestBudget(limit = HOSTED_ACCEPTANCE_LIMIT) {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > HOSTED_REQUEST_LIMIT)
    throw new RangeError(
      'A hosted stage needs a positive request allowance within the total budget.',
    );
  let sent = 0;
  let blocked = 0;
  return {
    claim(): boolean {
      if (sent >= limit) {
        blocked += 1;
        return false;
      }
      sent += 1;
      return true;
    },
    report: () => ({ limit, sent, blocked }),
  };
}

export async function boundHostedBrowserRequests(
  context: Pick<BrowserContext, 'route'>,
  request: Pick<APIRequestContext, 'fetch'>,
  budget: ReturnType<typeof createHostedRequestBudget>,
  options: { failures: string[]; allowedMethods?: readonly string[] },
): Promise<void> {
  const { failures, allowedMethods = ['GET'] } = options;
  await context.route('**/*', async (route) => {
    if (!budget.claim()) {
      await route.abort('blockedbyclient');
      return;
    }
    if (!allowedMethods.includes(route.request().method())) {
      failures.push('Hosted acceptance attempted an unexpected request method.');
      await route.abort('blockedbyclient');
      return;
    }
    // Reuse origin-scoped Access authentication and forbid hidden redirect/retry requests.
    const response = await request.fetch(route.request().url(), {
      method: route.request().method(),
      data: route.request().postDataBuffer() ?? undefined,
      headers: route.request().headers(),
      maxRedirects: 0,
      maxRetries: 0,
    });
    if (response.status() >= 300 && response.status() < 400) {
      failures.push('Hosted acceptance encountered an unexpected redirect.');
      await route.abort('blockedbyclient');
      return;
    }
    await route.fulfill({ response });
  });
}
