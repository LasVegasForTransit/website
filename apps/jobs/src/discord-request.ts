export async function readDiscordInput(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const state = { timedOut: false };
  const timer = setTimeout(() => {
    state.timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, 1000);
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let bytes = 0;
  let body = '';
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      const chunk: unknown = part.value;
      if (!(chunk instanceof Uint8Array)) return null;
      bytes += chunk.byteLength;
      if (bytes > 8192) return null;
      body += decoder.decode(chunk, { stream: true });
    }
    return state.timedOut ? null : (JSON.parse(body + decoder.decode()) as unknown);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
}

export function discordResponse(kind: string, status: number): Response {
  return Response.json({ kind }, { status, headers: { 'Cache-Control': 'no-store' } });
}
