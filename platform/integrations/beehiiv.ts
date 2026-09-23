// Beehiiv holds LVBT's mailing list. Subscribing someone here is what makes
// them a member today, so the platform subscribes every new member.

export interface BeehiivConfig {
  apiKey: string;
  publicationId: string;
}

export type SubscribeResult = { ok: true; subscriptionId: string | null } | { ok: false };

export async function subscribe(
  config: BeehiivConfig,
  email: string,
  options: { sendWelcomeEmail: boolean; utmSource: string },
  fetcher: typeof fetch = fetch,
): Promise<SubscribeResult> {
  let response: Response;
  try {
    response = await fetcher(
      `https://api.beehiiv.com/v2/publications/${config.publicationId}/subscriptions`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          reactivate_existing: true,
          send_welcome_email: options.sendWelcomeEmail,
          // Consent is the ticked box on LVBT's own form, recorded in the
          // person record with its wording, so Beehiiv's own confirmation
          // step would only strand members as pending.
          double_opt_override: 'off',
          utm_source: options.utmSource,
        }),
        signal: AbortSignal.timeout(8000),
      },
    );
  } catch {
    console.error('Beehiiv subscribe request failed');
    return { ok: false };
  }
  if (!response.ok) {
    console.error(
      'Beehiiv subscribe failed',
      response.status,
      await response.text().catch(() => ''),
    );
    return { ok: false };
  }
  const body: unknown = await response.json().catch(() => null);
  const data =
    typeof body === 'object' && body !== null
      ? (body as { data?: { id?: unknown } }).data
      : undefined;
  return { ok: true, subscriptionId: typeof data?.id === 'string' ? data.id : null };
}

export async function unsubscribe(
  config: BeehiivConfig,
  subscriptionId: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher(
      `https://api.beehiiv.com/v2/publications/${config.publicationId}/subscriptions/${subscriptionId}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ unsubscribe: true }),
        signal: AbortSignal.timeout(8000),
      },
    );
    await response.body?.cancel();
    return response.ok;
  } catch {
    console.error('Beehiiv unsubscribe request failed');
    return false;
  }
}
