import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { User } from '../shared/api.ts';
import type { DB } from './db.ts';

// --- passwords -------------------------------------------------------------
// scrypt is deliberately slow and memory-hard, which makes brute-forcing a
// leaked hash expensive. Each password gets its own random salt, and the cost
// parameters are stored alongside the hash so they can be raised later.

const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 32;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  // Constant-time comparison: no timing hints about how many bytes matched.
  return timingSafeEqual(actual, expected);
}

/** Compared against when a username doesn't exist, so a failed login takes
 *  the same time either way and doesn't reveal which usernames are real. */
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));

// --- sessions --------------------------------------------------------------
// The browser holds a random 256-bit token in an HttpOnly cookie. The database
// only stores its SHA-256, so a leaked database can't be used to log in.

export const SESSION_COOKIE = 'lanes_sid';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function createSession(db: DB, userId: number): string {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    sha256(token),
    userId,
    Date.now() + SESSION_TTL_MS,
  );
  return token;
}

export function deleteSession(db: DB, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function purgeExpiredSessions(db: DB): void {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

export function readCookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function userFromRequest(db: DB, req: IncomingMessage): User | null {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(sha256(token), Date.now()) as { id: number; username: string } | undefined;
  return row ? { id: row.id, username: row.username } : null;
}

export function sessionCookie(token: string, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly', // page scripts can't read it, so an XSS bug can't steal it
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function clearedSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

// --- brute-force protection ------------------------------------------------

/** Fixed-window counter: at most `limit` hits per key per window. */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private limit: number,
    private windowMs: number,
  ) {}

  /** Seconds until the key may try again, or 0 if it's under the limit. */
  retryAfter(key: string): number {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= Date.now()) return 0;
    return entry.count >= this.limit ? Math.ceil((entry.resetAt - Date.now()) / 1000) : 0;
  }

  hit(key: string): void {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 10_000) this.prune(now);
    } else {
      entry.count++;
    }
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(now: number): void {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}
