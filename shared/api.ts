// The API contract shared by the server and the browser client.
// Both sides import these types, so a change to a response shape is a
// compile error on whichever side didn't get updated.

export type Role = 'owner' | 'member';

export interface User {
  id: number;
  username: string;
}

export interface BoardSummary {
  id: number;
  name: string;
  role: Role;
  memberCount: number;
  cardCount: number;
  updatedAt: string;
}

export interface Column {
  id: number;
  boardId: number;
  name: string;
  position: number;
}

export interface Card {
  id: number;
  boardId: number;
  columnId: number;
  title: string;
  description: string;
  position: number;
  createdBy: string;
  updatedAt: string;
}

export interface Member {
  userId: number;
  username: string;
  role: Role;
}

export interface BoardDetail {
  id: number;
  name: string;
  role: Role;
  columns: Column[];
  cards: Card[];
  members: Member[];
}

/** Pushed to every open tab on a board over Server-Sent Events. */
export type BoardEvent =
  | { type: 'board.updated'; board: { id: number; name: string } }
  | { type: 'board.deleted'; boardId: number }
  | { type: 'column.upserted'; column: Column }
  | { type: 'column.deleted'; columnId: number }
  | { type: 'card.upserted'; card: Card }
  | { type: 'card.deleted'; cardId: number }
  | { type: 'member.added'; member: Member };

export interface ApiErrorBody {
  error: { code: string; message: string; field?: string };
}

/**
 * Every state-changing request must carry this header. Browsers won't let
 * another site add custom headers to a cross-origin request without a CORS
 * preflight (which this server never approves), so this blocks CSRF.
 */
export const CSRF_HEADER = 'x-lanes-csrf';

export const LIMITS = {
  username: { min: 3, max: 32 },
  password: { min: 8, max: 200 },
  boardName: { min: 1, max: 80 },
  columnName: { min: 1, max: 60 },
  cardTitle: { min: 1, max: 200 },
  cardDescription: { min: 0, max: 5000 },
} as const;
