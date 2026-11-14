import type { IncomingMessage, ServerResponse } from 'node:http';
import { CSRF_HEADER } from '../shared/api.ts';
import { RateLimiter, userFromRequest } from './auth.ts';
import type { DB } from './db.ts';
import { EventHub } from './events.ts';
import { HttpError, Router, STREAMING, readJsonBody, sendError, sendJson, type Ctx } from './http.ts';
import { registerRoutes } from './routes.ts';
import { serveStatic } from './static.ts';

export interface AppOptions {
  db: DB;
  /** Directory of the built front-end; omit to serve the API only. */
  staticDir?: string;
  /** Add the `Secure` flag to cookies (enable when served over HTTPS). */
  secureCookies?: boolean;
  /** Log unexpected errors (default true). */
  logErrors?: boolean;
}

const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
};

export function createApp(opts: AppOptions) {
  const hub = new EventHub();
  const router = new Router();
  registerRoutes(router, {
    db: opts.db,
    hub,
    secureCookies: opts.secureCookies ?? false,
    loginLimiter: new RateLimiter(10, 15 * 60 * 1000),
  });

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const method = req.method ?? 'GET';
    const match = router.match(method, url.pathname);
    if (match === null) throw new HttpError(404, 'not_found', 'No such endpoint');
    if (match === 'wrong-method') throw new HttpError(405, 'method_not_allowed', 'Method not allowed');

    if (method !== 'GET' && method !== 'HEAD' && req.headers[CSRF_HEADER] !== '1') {
      throw new HttpError(403, 'csrf', `Missing ${CSRF_HEADER} header`);
    }

    const ctx: Ctx = {
      req,
      res,
      url,
      params: match.params,
      body: method === 'POST' || method === 'PATCH' ? await readJsonBody(req) : undefined,
      user: userFromRequest(opts.db, req),
      ip: req.socket.remoteAddress ?? 'unknown',
    };

    const result = await match.handler(ctx);
    if (result === STREAMING) return;
    if (result === undefined) {
      res.writeHead(ctx.status ?? 204);
      res.end();
    } else {
      sendJson(res, ctx.status ?? 200, result);
    }
  }

  async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
      } else if (opts.staticDir) {
        await serveStatic(opts.staticDir, url.pathname, req, res);
      } else {
        throw new HttpError(404, 'not_found', 'Not found');
      }
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (err instanceof HttpError) {
        sendError(res, err);
      } else {
        if (opts.logErrors !== false) console.error(`${req.method} ${url.pathname} failed:`, err);
        sendError(res, new HttpError(500, 'internal', 'Something went wrong on our end'));
      }
    }
  }

  return { handler, hub };
}
