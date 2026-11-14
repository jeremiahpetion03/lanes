import { HttpError, notFound } from './http.ts';

// Request bodies arrive as `unknown`. These helpers narrow them to the shapes
// handlers expect, or throw a 400 that names the offending field.

const bad = (field: string, message: string) => new HttpError(400, 'invalid_input', message, field);

export function object(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_input', 'Expected a JSON object body');
  }
  return body as Record<string, unknown>;
}

interface StrOpts {
  min: number;
  max: number;
  pattern?: RegExp;
  patternMessage?: string;
  trim?: boolean;
}

export function string(o: Record<string, unknown>, field: string, opts: StrOpts): string {
  const raw = o[field];
  if (typeof raw !== 'string') throw bad(field, `${field} must be a string`);
  const value = opts.trim === false ? raw : raw.trim();
  if (value.length < opts.min) {
    throw bad(field, opts.min === 1 ? `${field} is required` : `${field} must be at least ${opts.min} characters`);
  }
  if (value.length > opts.max) throw bad(field, `${field} must be at most ${opts.max} characters`);
  if (opts.pattern && !opts.pattern.test(value)) throw bad(field, opts.patternMessage ?? `${field} is invalid`);
  return value;
}

export function optionalString(o: Record<string, unknown>, field: string, opts: StrOpts): string | undefined {
  return o[field] === undefined ? undefined : string(o, field, opts);
}

export function integer(o: Record<string, unknown>, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const v = o[field];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw bad(field, `${field} must be an integer between ${min} and ${max}`);
  }
  return v;
}

/** Route ids like `/api/boards/:id`. A malformed id is a 404, not a 400. */
export function id(params: Record<string, string>, name: string, what: string): number {
  const raw = params[name] ?? '';
  const n = Number(raw);
  if (!/^\d{1,15}$/.test(raw) || n <= 0) throw notFound(what);
  return n;
}
