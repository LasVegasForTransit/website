interface HostedResponse {
  url(): string;
  request(): { resourceType(): string };
  headers(): Record<string, string>;
}

export function isProviderSpeculationResponse(response: HostedResponse): boolean {
  // Cloudflare serves this metadata outside the Worker, so it cannot carry the
  // Worker's preview headers. Keep site content and all other endpoints checked.
  return (
    new URL(response.url()).pathname === '/cdn-cgi/speculation' &&
    response.request().resourceType() === 'other' &&
    response.headers()['content-type']?.split(';')[0]?.trim() ===
      'application/speculationrules+json'
  );
}
