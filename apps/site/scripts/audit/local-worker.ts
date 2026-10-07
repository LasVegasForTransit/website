import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';

const HOST = '127.0.0.1';
function fail(message: string): never {
  throw new Error(message);
}

async function availablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      if (!address || typeof address === 'string') fail('Could not reserve a local port.');
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForWorker(url: string, process: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (process.exitCode !== null) fail(`Wrangler exited with code ${process.exitCode}.`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The local socket is not accepting requests yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail('Wrangler did not become ready within 15 seconds.');
}

async function stop(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) return;
  process.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    process.once('exit', () => resolve());
    setTimeout(() => resolve(), 5_000).unref();
  });
}

export async function withLocalWorker(verify: (origin: string) => Promise<void>): Promise<void> {
  const root = process.cwd();
  const port = await availablePort();
  const baseUrl = `http://${HOST}:${port}`;
  const wrangler = spawn('pnpm', ['exec', 'wrangler', 'dev', '--local', '--port', String(port)], {
    cwd: root,
    env: { ...process.env, WRANGLER_LOG: 'error' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  wrangler.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  wrangler.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });

  try {
    await waitForWorker(baseUrl, wrangler);
    await verify(baseUrl);
  } catch (error) {
    process.stderr.write(output);
    throw error;
  } finally {
    await stop(wrangler);
  }
}
