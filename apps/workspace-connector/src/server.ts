import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createWorkspaceConnector } from './connector';
import { loadConfig } from './config';
const config = loadConfig(process.env);
const connector = createWorkspaceConnector(config);
async function handle(incoming: IncomingMessage, outgoing: ServerResponse) {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of incoming) {
    const bytes: unknown = chunk;
    if (!(bytes instanceof Uint8Array)) throw new Error('Invalid request');
    length += bytes.length;
    if (length > 65536) {
      outgoing.writeHead(413).end();
      return;
    }
    chunks.push(bytes);
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (typeof value === 'string') headers.set(name, value);
  }
  const method = incoming.method ?? 'GET';
  const result = await connector.fetch(
    new Request(new URL(incoming.url ?? '/', config.origin), {
      method,
      headers,
      ...(length > 0 ? { body: Buffer.concat(chunks) } : {}),
    }),
  );
  outgoing.writeHead(result.status, Object.fromEntries(result.headers));
  outgoing.end(Buffer.from(await result.arrayBuffer()));
}
const server = createServer((incoming, outgoing) => {
  void handle(incoming, outgoing).catch(() => {
    outgoing.writeHead(503).end();
  });
});
server.requestTimeout = 10000;
server.headersTimeout = 10000;
const port = Number(Object.entries(process.env).find(([key]) => key === 'PORT')?.[1] ?? 8080);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
server.listen(port, '0.0.0.0');
