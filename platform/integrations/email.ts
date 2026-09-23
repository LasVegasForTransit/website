// The one function that sends transactional email: messages sent to one
// person because of something they did. It uses Resend's free plan, sending
// from notify.lasvegasfortransit.org. When no Resend key is configured it
// sends nothing and says so, so callers can fall back.

export interface EmailConfig {
  resendApiKey?: string;
}

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Tags the message for Resend's logs, for example "join_confirmation". */
  template: string;
}

export type SendResult = 'sent' | 'not_configured' | 'failed';

export const FROM_ADDRESS = 'Las Vegans for Better Transit <hello@notify.lasvegasfortransit.org>';
export const REPLY_TO = 'hello@lasvegasfortransit.org';

export function emailConfigured(config: EmailConfig): boolean {
  return Boolean(config.resendApiKey);
}

export async function sendEmail(
  config: EmailConfig,
  email: Email,
  fetcher: typeof fetch = fetch,
): Promise<SendResult> {
  if (!config.resendApiKey) return 'not_configured';
  try {
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [email.to],
        reply_to: REPLY_TO,
        subject: email.subject,
        text: email.text,
        html: email.html,
        tags: [{ name: 'template', value: email.template }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.error(`Resend rejected a ${email.template} email`, response.status);
      return 'failed';
    }
    await response.body?.cancel();
    return 'sent';
  } catch {
    console.error(`Resend request failed for a ${email.template} email`);
    return 'failed';
  }
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
