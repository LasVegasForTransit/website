async function readResult(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.status !== 200) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  let bytes = 0;
  let text = '';
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      const chunk: unknown = part.value;
      if (!(chunk instanceof Uint8Array)) return null;
      bytes += chunk.byteLength;
      if (bytes > 512) return null;
      text += decoder.decode(chunk, { stream: true });
    }
    const value: unknown = JSON.parse(text + decoder.decode());
    return signal.aborted ? null : value;
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
  }
}

export async function requestDiscordService(
  jobs: Pick<Fetcher, 'fetch'>,
  path: '/discord/join' | '/discord/disconnect',
  input: unknown,
): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      jobs
        .fetch(
          new Request(`https://jobs.internal${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
            redirect: 'manual',
            signal: controller.signal,
          }),
        )
        .then(async (response) => await readResult(response, controller.signal)),
      new Promise<unknown>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(null);
        }, 20_000);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
