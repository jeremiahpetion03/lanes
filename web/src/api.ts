import type { ApiErrorBody, BoardDetail, BoardSummary, Card, Column, Member, User } from '../../shared/api.ts';
import { CSRF_HEADER } from '../../shared/api.ts';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { [CSRF_HEADER]: '1' };
  if (body !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', "Can't reach the server. Check your connection.");
  }

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? 'http_error', e?.message ?? `Request failed (${res.status})`, e?.field);
  }
  return data as T;
}

/** Typed wrappers for every endpoint. Response types come from shared/api.ts. */
export const api = {
  me: () => request<{ user: User }>('GET', '/api/auth/me'),
  register: (username: string, password: string) =>
    request<{ user: User }>('POST', '/api/auth/register', { username, password }),
  login: (username: string, password: string) =>
    request<{ user: User }>('POST', '/api/auth/login', { username, password }),
  logout: () => request<void>('POST', '/api/auth/logout'),

  listBoards: () => request<{ boards: BoardSummary[] }>('GET', '/api/boards'),
  createBoard: (name: string) => request<{ board: BoardDetail }>('POST', '/api/boards', { name }),
  getBoard: (id: number) => request<{ board: BoardDetail }>('GET', `/api/boards/${id}`),
  renameBoard: (id: number, name: string) => request<unknown>('PATCH', `/api/boards/${id}`, { name }),
  deleteBoard: (id: number) => request<void>('DELETE', `/api/boards/${id}`),
  addMember: (boardId: number, username: string) =>
    request<{ member: Member }>('POST', `/api/boards/${boardId}/members`, { username }),

  createColumn: (boardId: number, name: string) =>
    request<{ column: Column }>('POST', `/api/boards/${boardId}/columns`, { name }),
  renameColumn: (id: number, name: string) => request<{ column: Column }>('PATCH', `/api/columns/${id}`, { name }),
  deleteColumn: (id: number) => request<void>('DELETE', `/api/columns/${id}`),

  createCard: (columnId: number, title: string) =>
    request<{ card: Card }>('POST', `/api/columns/${columnId}/cards`, { title }),
  updateCard: (id: number, patch: { title?: string; description?: string }) =>
    request<{ card: Card }>('PATCH', `/api/cards/${id}`, patch),
  moveCard: (id: number, columnId: number, index: number) =>
    request<{ card: Card }>('POST', `/api/cards/${id}/move`, { columnId, index }),
  deleteCard: (id: number) => request<void>('DELETE', `/api/cards/${id}`),
};

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong');
