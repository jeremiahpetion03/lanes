import type { BoardDetail, BoardEvent, BoardSummary, Card, Column, Member, Role, User } from '../shared/api.ts';
import { LIMITS } from '../shared/api.ts';
import { GAP, needsRebalance, positionBetween } from '../shared/ordering.ts';
import {
  DUMMY_HASH,
  RateLimiter,
  SESSION_COOKIE,
  clearedSessionCookie,
  createSession,
  deleteSession,
  hashPassword,
  purgeExpiredSessions,
  readCookie,
  sessionCookie,
  verifyPassword,
} from './auth.ts';
import { tx, type DB } from './db.ts';
import type { EventHub } from './events.ts';
import { HttpError, STREAMING, notFound, type Ctx, type Router } from './http.ts';
import * as v from './validate.ts';

export interface Deps {
  db: DB;
  hub: EventHub;
  secureCookies: boolean;
  loginLimiter: RateLimiter;
}

// --- row mapping -----------------------------------------------------------

interface CardRow {
  id: number;
  board_id: number;
  column_id: number;
  title: string;
  description: string;
  position: number;
  created_by: string;
  updated_at: number;
}

interface ColumnRow {
  id: number;
  board_id: number;
  name: string;
  position: number;
}

const toCard = (r: CardRow): Card => ({
  id: r.id,
  boardId: r.board_id,
  columnId: r.column_id,
  title: r.title,
  description: r.description,
  position: r.position,
  createdBy: r.created_by,
  updatedAt: new Date(r.updated_at).toISOString(),
});

const toColumn = (r: ColumnRow): Column => ({
  id: r.id,
  boardId: r.board_id,
  name: r.name,
  position: r.position,
});

const CARD_SELECT = `
  SELECT c.id, c.board_id, c.column_id, c.title, c.description, c.position,
         u.username AS created_by, c.updated_at
  FROM cards c JOIN users u ON u.id = c.created_by`;

// --- field rules (shared limits keep client and server validation in sync) --

const USERNAME = {
  ...LIMITS.username,
  pattern: /^[A-Za-z0-9_-]+$/,
  patternMessage: 'username may only contain letters, numbers, _ and -',
};
const PASSWORD = { ...LIMITS.password, trim: false };

export function registerRoutes(router: Router, deps: Deps): void {
  const { db, hub } = deps;

  // --- authorization helpers ---------------------------------------------
  // Every query that touches a board, column or card goes through one of
  // these, which join against board_members. A user who isn't a member gets
  // a 404, the same as for something that doesn't exist, so ids of other
  // people's boards can't even be confirmed.

  function requireUser(ctx: Ctx): User {
    if (!ctx.user) throw new HttpError(401, 'unauthenticated', 'Please log in');
    return ctx.user;
  }

  function boardRole(boardId: number, userId: number): Role | null {
    const row = db
      .prepare('SELECT role FROM board_members WHERE board_id = ? AND user_id = ?')
      .get(boardId, userId) as { role: Role } | undefined;
    return row?.role ?? null;
  }

  function requireBoard(boardId: number, user: User, ownerOnly = false): Role {
    const role = boardRole(boardId, user.id);
    if (!role) throw notFound('Board');
    if (ownerOnly && role !== 'owner') {
      throw new HttpError(403, 'forbidden', 'Only the board owner can do that');
    }
    return role;
  }

  function requireColumn(columnId: number, user: User): ColumnRow {
    const row = db
      .prepare(
        `SELECT c.id, c.board_id, c.name, c.position FROM columns c
         JOIN board_members m ON m.board_id = c.board_id AND m.user_id = ?
         WHERE c.id = ?`,
      )
      .get(user.id, columnId) as ColumnRow | undefined;
    if (!row) throw notFound('Column');
    return row;
  }

  function requireCard(cardId: number, user: User): CardRow {
    const row = db
      .prepare(
        `${CARD_SELECT}
         JOIN board_members m ON m.board_id = c.board_id AND m.user_id = ?
         WHERE c.id = ?`,
      )
      .get(user.id, cardId) as CardRow | undefined;
    if (!row) throw notFound('Card');
    return row;
  }

  const getCard = (id: number) => toCard(db.prepare(`${CARD_SELECT} WHERE c.id = ?`).get(id) as unknown as CardRow);
  const getColumn = (id: number) =>
    toColumn(db.prepare('SELECT id, board_id, name, position FROM columns WHERE id = ?').get(id) as unknown as ColumnRow);
  const touchBoard = (boardId: number) =>
    db.prepare('UPDATE boards SET updated_at = ? WHERE id = ?').run(Date.now(), boardId);

  // --- auth ----------------------------------------------------------------

  function startSession(ctx: Ctx, user: User) {
    const token = createSession(db, user.id);
    ctx.res.setHeader('set-cookie', sessionCookie(token, deps.secureCookies));
    return { user };
  }

  router.post('/api/auth/register', async (ctx) => {
    const body = v.object(ctx.body);
    const username = v.string(body, 'username', USERNAME);
    const password = v.string(body, 'password', PASSWORD);
    const hash = await hashPassword(password);
    try {
      const r = db
        .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
        .run(username, hash, Date.now());
      ctx.status = 201;
      return startSession(ctx, { id: Number(r.lastInsertRowid), username });
    } catch (err) {
      // The UNIQUE constraint is the real check, so two simultaneous sign-ups
      // for the same name can't both succeed.
      if (String(err).includes('UNIQUE')) {
        throw new HttpError(409, 'username_taken', 'That username is already taken', 'username');
      }
      throw err;
    }
  });

  router.post('/api/auth/login', async (ctx) => {
    const body = v.object(ctx.body);
    const username = v.string(body, 'username', { min: 1, max: LIMITS.username.max });
    const password = v.string(body, 'password', { min: 1, max: LIMITS.password.max, trim: false });

    const key = `${ctx.ip}|${username.toLowerCase()}`;
    const wait = deps.loginLimiter.retryAfter(key);
    if (wait > 0) {
      ctx.res.setHeader('retry-after', String(wait));
      throw new HttpError(429, 'rate_limited', `Too many failed attempts. Try again in ${wait} seconds.`);
    }

    const row = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username) as
      | { id: number; username: string; password_hash: string }
      | undefined;
    const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok) {
      deps.loginLimiter.hit(key);
      // Same message either way: don't reveal whether the username exists.
      throw new HttpError(401, 'invalid_credentials', 'Incorrect username or password');
    }
    deps.loginLimiter.reset(key);
    purgeExpiredSessions(db);
    return startSession(ctx, { id: row.id, username: row.username });
  });

  router.post('/api/auth/logout', (ctx) => {
    const token = readCookie(ctx.req, SESSION_COOKIE);
    if (token) deleteSession(db, token);
    ctx.res.setHeader('set-cookie', clearedSessionCookie(deps.secureCookies));
  });

  router.get('/api/auth/me', (ctx) => ({ user: requireUser(ctx) }));

  // --- boards ----------------------------------------------------------------

  router.get('/api/boards', (ctx) => {
    const user = requireUser(ctx);
    const rows = db
      .prepare(
        `SELECT b.id, b.name, m.role, b.updated_at,
                (SELECT COUNT(*) FROM board_members WHERE board_id = b.id) AS member_count,
                (SELECT COUNT(*) FROM cards WHERE board_id = b.id) AS card_count
         FROM boards b JOIN board_members m ON m.board_id = b.id AND m.user_id = ?
         ORDER BY b.updated_at DESC`,
      )
      .all(user.id) as {
      id: number;
      name: string;
      role: Role;
      updated_at: number;
      member_count: number;
      card_count: number;
    }[];
    const boards: BoardSummary[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      memberCount: r.member_count,
      cardCount: r.card_count,
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
    return { boards };
  });

  router.post('/api/boards', (ctx) => {
    const user = requireUser(ctx);
    const name = v.string(v.object(ctx.body), 'name', LIMITS.boardName);
    const boardId = tx(db, () => {
      const now = Date.now();
      const id = Number(
        db.prepare('INSERT INTO boards (name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
          name,
          user.id,
          now,
          now,
        ).lastInsertRowid,
      );
      db.prepare("INSERT INTO board_members (board_id, user_id, role) VALUES (?, ?, 'owner')").run(id, user.id);
      const addColumn = db.prepare('INSERT INTO columns (board_id, name, position) VALUES (?, ?, ?)');
      ['To do', 'In progress', 'Done'].forEach((col, i) => addColumn.run(id, col, (i + 1) * GAP));
      return id;
    });
    ctx.status = 201;
    return { board: loadBoard(boardId, 'owner') };
  });

  function loadBoard(boardId: number, role: Role): BoardDetail {
    const board = db.prepare('SELECT id, name FROM boards WHERE id = ?').get(boardId) as { id: number; name: string };
    const columns = (
      db.prepare('SELECT id, board_id, name, position FROM columns WHERE board_id = ? ORDER BY position').all(
        boardId,
      ) as unknown as ColumnRow[]
    ).map(toColumn);
    const cards = (
      db.prepare(`${CARD_SELECT} WHERE c.board_id = ? ORDER BY c.position`).all(boardId) as unknown as CardRow[]
    ).map(toCard);
    const members = (
      db
        .prepare(
          `SELECT u.id AS userId, u.username, m.role FROM board_members m JOIN users u ON u.id = m.user_id
           WHERE m.board_id = ? ORDER BY m.role DESC, u.username`,
        )
        .all(boardId) as unknown as Member[]
    ).map((m) => ({ userId: m.userId, username: m.username, role: m.role }));
    return { id: board.id, name: board.name, role, columns, cards, members };
  }

  router.get('/api/boards/:id', (ctx) => {
    const user = requireUser(ctx);
    const boardId = v.id(ctx.params, 'id', 'Board');
    return { board: loadBoard(boardId, requireBoard(boardId, user)) };
  });

  router.patch('/api/boards/:id', (ctx) => {
    const user = requireUser(ctx);
    const boardId = v.id(ctx.params, 'id', 'Board');
    requireBoard(boardId, user);
    const name = v.string(v.object(ctx.body), 'name', LIMITS.boardName);
    db.prepare('UPDATE boards SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), boardId);
    hub.publish(boardId, [{ type: 'board.updated', board: { id: boardId, name } }]);
    return { board: { id: boardId, name } };
  });

  router.delete('/api/boards/:id', (ctx) => {
    const user = requireUser(ctx);
    const boardId = v.id(ctx.params, 'id', 'Board');
    requireBoard(boardId, user, true);
    db.prepare('DELETE FROM boards WHERE id = ?').run(boardId); // cascades to columns, cards, members
    hub.publish(boardId, [{ type: 'board.deleted', boardId }]);
    hub.closeBoard(boardId);
  });

  router.post('/api/boards/:id/members', (ctx) => {
    const user = requireUser(ctx);
    const boardId = v.id(ctx.params, 'id', 'Board');
    requireBoard(boardId, user, true);
    const username = v.string(v.object(ctx.body), 'username', { min: 1, max: LIMITS.username.max });
    const invitee = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username) as
      | { id: number; username: string }
      | undefined;
    if (!invitee) throw new HttpError(404, 'user_not_found', `No user named "${username}"`, 'username');
    if (boardRole(boardId, invitee.id)) {
      throw new HttpError(409, 'already_member', `${invitee.username} is already on this board`, 'username');
    }
    db.prepare("INSERT INTO board_members (board_id, user_id, role) VALUES (?, ?, 'member')").run(boardId, invitee.id);
    touchBoard(boardId);
    const member: Member = { userId: invitee.id, username: invitee.username, role: 'member' };
    hub.publish(boardId, [{ type: 'member.added', member }]);
    ctx.status = 201;
    return { member };
  });

  router.get('/api/boards/:id/events', (ctx) => {
    const user = requireUser(ctx);
    const boardId = v.id(ctx.params, 'id', 'Board');
    requireBoard(boardId, user);
    hub.subscribe(boardId, ctx.res);
    return STREAMING;
  });

  // --- columns ---------------------------------------------------------------

  router.post('/api/boards/:id/columns', (ctx) => {
    const user = requireUser(ctx);
    const boardId = v.id(ctx.params, 'id', 'Board');
    requireBoard(boardId, user);
    const name = v.string(v.object(ctx.body), 'name', LIMITS.columnName);
    const { max } = db.prepare('SELECT MAX(position) AS max FROM columns WHERE board_id = ?').get(boardId) as {
      max: number | null;
    };
    const id = Number(
      db
        .prepare('INSERT INTO columns (board_id, name, position) VALUES (?, ?, ?)')
        .run(boardId, name, positionBetween(max ?? undefined)).lastInsertRowid,
    );
    touchBoard(boardId);
    const column = getColumn(id);
    hub.publish(boardId, [{ type: 'column.upserted', column }]);
    ctx.status = 201;
    return { column };
  });

  router.patch('/api/columns/:id', (ctx) => {
    const user = requireUser(ctx);
    const col = requireColumn(v.id(ctx.params, 'id', 'Column'), user);
    const name = v.string(v.object(ctx.body), 'name', LIMITS.columnName);
    db.prepare('UPDATE columns SET name = ? WHERE id = ?').run(name, col.id);
    touchBoard(col.board_id);
    const column = getColumn(col.id);
    hub.publish(col.board_id, [{ type: 'column.upserted', column }]);
    return { column };
  });

  router.delete('/api/columns/:id', (ctx) => {
    const user = requireUser(ctx);
    const col = requireColumn(v.id(ctx.params, 'id', 'Column'), user);
    db.prepare('DELETE FROM columns WHERE id = ?').run(col.id); // its cards cascade
    touchBoard(col.board_id);
    hub.publish(col.board_id, [{ type: 'column.deleted', columnId: col.id }]);
  });

  // --- cards -----------------------------------------------------------------

  router.post('/api/columns/:id/cards', (ctx) => {
    const user = requireUser(ctx);
    const col = requireColumn(v.id(ctx.params, 'id', 'Column'), user);
    const body = v.object(ctx.body);
    const title = v.string(body, 'title', LIMITS.cardTitle);
    const description = v.optionalString(body, 'description', LIMITS.cardDescription) ?? '';
    const { max } = db.prepare('SELECT MAX(position) AS max FROM cards WHERE column_id = ?').get(col.id) as {
      max: number | null;
    };
    const id = Number(
      db
        .prepare(
          `INSERT INTO cards (board_id, column_id, title, description, position, created_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(col.board_id, col.id, title, description, positionBetween(max ?? undefined), user.id, Date.now())
        .lastInsertRowid,
    );
    touchBoard(col.board_id);
    const card = getCard(id);
    hub.publish(col.board_id, [{ type: 'card.upserted', card }]);
    ctx.status = 201;
    return { card };
  });

  router.patch('/api/cards/:id', (ctx) => {
    const user = requireUser(ctx);
    const existing = requireCard(v.id(ctx.params, 'id', 'Card'), user);
    const body = v.object(ctx.body);
    const title = v.optionalString(body, 'title', LIMITS.cardTitle) ?? existing.title;
    const description = v.optionalString(body, 'description', LIMITS.cardDescription) ?? existing.description;
    db.prepare('UPDATE cards SET title = ?, description = ?, updated_at = ? WHERE id = ?').run(
      title,
      description,
      Date.now(),
      existing.id,
    );
    touchBoard(existing.board_id);
    const card = getCard(existing.id);
    hub.publish(existing.board_id, [{ type: 'card.upserted', card }]);
    return { card };
  });

  /**
   * Move a card to `index` within column `columnId` (index counts the other
   * cards in that column, so 0 = top). The server computes the position from
   * the card's new neighbours; the client never sends raw positions.
   */
  router.post('/api/cards/:id/move', (ctx) => {
    const user = requireUser(ctx);
    const existing = requireCard(v.id(ctx.params, 'id', 'Card'), user);
    const body = v.object(ctx.body);
    const columnId = v.integer(body, 'columnId', 1);
    const index = v.integer(body, 'index', 0, 100_000);
    const target = requireColumn(columnId, user);
    if (target.board_id !== existing.board_id) {
      throw new HttpError(400, 'invalid_input', 'Cards can only move within their board', 'columnId');
    }

    const events: BoardEvent[] = tx(db, () => {
      const siblings = db
        .prepare('SELECT id, position FROM cards WHERE column_id = ? AND id <> ? ORDER BY position')
        .all(columnId, existing.id) as { id: number; position: number }[];
      const i = Math.min(index, siblings.length);
      const before = siblings[i - 1]?.position;
      const after = siblings[i]?.position;
      const setPosition = db.prepare('UPDATE cards SET position = ? WHERE id = ?');
      const changed: number[] = [existing.id];

      let position: number;
      if (needsRebalance(before, after)) {
        // Out of float precision between these two: renumber the column,
        // leaving a gap at the target index.
        siblings.forEach((s, k) => {
          setPosition.run((k < i ? k + 1 : k + 2) * GAP, s.id);
          changed.push(s.id);
        });
        position = (i + 1) * GAP;
      } else {
        position = positionBetween(before, after);
      }
      db.prepare('UPDATE cards SET column_id = ?, position = ?, updated_at = ? WHERE id = ?').run(
        columnId,
        position,
        Date.now(),
        existing.id,
      );
      touchBoard(existing.board_id);
      return changed.map((id) => ({ type: 'card.upserted', card: getCard(id) }) as const);
    });

    hub.publish(existing.board_id, events);
    return { card: getCard(existing.id) };
  });

  router.delete('/api/cards/:id', (ctx) => {
    const user = requireUser(ctx);
    const card = requireCard(v.id(ctx.params, 'id', 'Card'), user);
    db.prepare('DELETE FROM cards WHERE id = ?').run(card.id);
    touchBoard(card.board_id);
    hub.publish(card.board_id, [{ type: 'card.deleted', cardId: card.id }]);
  });
}
