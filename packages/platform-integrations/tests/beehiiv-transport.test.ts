import assert from 'node:assert/strict';
import test from 'node:test';
import { beehiivJsonBody } from '../src/beehiiv-transport';

void test('an already expired request cancels the body before waiting for another chunk', async () => {
  const state = { cancelled: false };
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
      cancel() {
        state.cancelled = true;
      },
    }),
  );
  const reading = beehiivJsonBody(response, AbortSignal.abort());
  await Promise.resolve();
  const cancelledImmediately = state.cancelled;
  if (!state.cancelled) controller?.close();
  assert.equal(await reading, null);
  assert.equal(cancelledImmediately, true);
});
