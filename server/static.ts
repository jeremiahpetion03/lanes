import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { HttpError } from './http.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** Serve the built front-end. Unknown paths without a file extension fall
 *  back to index.html so client-side routes survive a page refresh. */
export async function serveStatic(root: string, pathname: string, req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'Method not allowed');

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'bad_path', 'Malformed path');
  }
  const base = resolve(root);
  let file = resolve(base, '.' + (decoded === '/' ? '/index.html' : decoded));
  // Path traversal guard: `/../../etc/passwd` must not escape the root.
  if (file !== base && !file.startsWith(base + sep)) throw new HttpError(404, 'not_found', 'Not found');

  let info = await stat(file).catch(() => null);
  if (!info?.isFile()) {
    if (extname(decoded)) throw new HttpError(404, 'not_found', 'Not found');
    file = resolve(base, 'index.html');
    info = await stat(file).catch(() => null);
    if (!info?.isFile()) throw new HttpError(404, 'not_found', 'Front-end not built. Run `npm run build`.');
  }

  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'content-length': info.size,
    'cache-control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}
