import type { IncomingMessage, ServerResponse } from 'node:http';
import type { User } from '../shared/api.ts';

/** Thrown by handlers; turned into a JSON error response. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found`);

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  body: unknown;
  user: User | null;
  ip: string;
  /** Response status for a successful handler (default 200, or 204 when nothing is returned). */
  status?: number;
}

export type Handler = (ctx: Ctx) => unknown;

/** Returned by handlers that took over the response (e.g. an event stream). */
export const STREAMING = Symbol('streaming');

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

/** A small path router: `/api/boards/:id` matches `/api/boards/42` with params.id = "42". */
export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: Handler): void {
    this.routes.push({ method, parts: path.split('/').filter(Boolean), handler });
  }
  get(path: string, h: Handler) { this.add('GET', path, h); }
  post(path: string, h: Handler) { this.add('POST', path, h); }
  patch(path: string, h: Handler) { this.add('PATCH', path, h); }
  delete(path: string, h: Handler) { this.add('DELETE', path, h); }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | 'wrong-method' | null {
    const parts = pathname.split('/').filter(Boolean);
    let pathMatched = false;
    for (const route of this.routes) {
      if (route.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      const ok = route.parts.every((p, i) => {
        if (p.startsWith(':')) {
          params[p.slice(1)] = decodeURIComponent(parts[i]!);
          return true;
        }
        return p === parts[i];
      });
      if (!ok) continue;
      pathMatched = true;
      if (route.method === method) return { handler: route.handler, params };
    }
    return pathMatched ? 'wrong-method' : null;
  }
}

const MAX_BODY = 64 * 1024;

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'body_too_large', 'Request body is too large');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return undefined;
  const type = req.headers['content-type'] ?? '';
  if (!type.startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Request body must be JSON');
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON');
  }
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

export function sendError(res: ServerResponse, err: HttpError): void {
  sendJson(res, err.status, {
    error: { code: err.code, message: err.message, ...(err.field ? { field: err.field } : {}) },
  });
}
