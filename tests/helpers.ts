import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CSRF_HEADER } from '../shared/api.ts';
import { createApp } from '../server/app.ts';
import { openDb, type DB } from '../server/db.ts';

export interface TestServer {
  url: string;
  db: DB;
  close: () => Promise<void>;
}

/** A real HTTP server on a random port with a fresh in-memory database. */
export async function startServer(): Promise<TestServer> {
  const db = openDb(':memory:');
  const { handler, hub } = createApp({ db, logErrors: false });
  const server: Server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    db,
    close: () =>
      new Promise((r) => {
        hub.closeAll();
        server.close(() => r());
      }),
  };
}

/** A browser-like client that keeps its session cookie between requests. */
export class Client {
  cookie = '';

  constructor(private base: string) {}

  async req(method: string, path: string, body?: unknown, opts: { csrf?: boolean } = {}) {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.cookie = this.cookie;
    if (opts.csrf !== false) headers[CSRF_HEADER] = '1';
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(this.base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(';')[0]!;
      this.cookie = pair.endsWith('=') ? '' : pair;
    }
    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = text ? JSON.parse(text) : undefined;
    return { status: res.status, data, headers: res.headers };
  }

  get = (path: string) => this.req('GET', path);
  post = (path: string, body?: unknown) => this.req('POST', path, body ?? {});
  patch = (path: string, body: unknown) => this.req('PATCH', path, body);
  del = (path: string) => this.req('DELETE', path);
}

export async function signUp(base: string, username: string, password = 'correct horse battery') {
  const c = new Client(base);
  const r = await c.post('/api/auth/register', { username, password });
  if (r.status !== 201) throw new Error(`register failed: ${JSON.stringify(r.data)}`);
  return c;
}
