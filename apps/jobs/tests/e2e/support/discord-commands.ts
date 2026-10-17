import assert from 'node:assert/strict';
import { Response, type Request } from 'miniflare';

/** Synthetic guild-command API for the compiled scheduled Worker. */
export function commandFixture(applicationId: string, guildId: string) {
  const calls: string[] = [];
  let command: unknown = null;
  const respond = async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (url.pathname !== `/api/v10/applications/${applicationId}/guilds/${guildId}/commands`)
      return null;
    calls.push(request.method);
    if (request.method === 'POST') {
      const body: unknown = await request.json();
      assert.deepEqual(body, {
        type: 1,
        name: 'link',
        description: 'Confirm your LVBT membership on the website',
        options: [],
      });
      command = { id: '101010101010101010', ...(body as object) };
      return new Response(JSON.stringify(command), { status: 201 });
    }
    assert.equal(request.method, 'GET');
    return new Response(JSON.stringify(command ? [command] : []));
  };
  return { calls, respond };
}
