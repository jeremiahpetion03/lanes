import { DatabaseSync } from 'node:sqlite';

export type DB = DatabaseSync;

// Append-only list of migrations. The database records how many have run in
// `PRAGMA user_version`, so upgrading an existing database only applies the
// new ones. Never edit a migration that has shipped; add a new one.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT    PRIMARY KEY,         -- SHA-256 of the cookie value
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE boards (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE board_members (
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role     TEXT    NOT NULL CHECK (role IN ('owner', 'member')),
    PRIMARY KEY (board_id, user_id)
  );
  CREATE INDEX board_members_user ON board_members(user_id);

  CREATE TABLE columns (
    id       INTEGER PRIMARY KEY,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name     TEXT    NOT NULL,
    position REAL    NOT NULL
  );
  CREATE INDEX columns_board ON columns(board_id, position);

  CREATE TABLE cards (
    id          INTEGER PRIMARY KEY,
    board_id    INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    column_id   INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    position    REAL    NOT NULL,
    created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX cards_column ON cards(column_id, position);
  CREATE INDEX cards_board ON cards(board_id);
  `,
];

export function openDb(path: string): DB {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let i = user_version; i < MIGRATIONS.length; i++) {
    tx(db, () => {
      db.exec(MIGRATIONS[i]!);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
}

/** Run `fn` in a transaction: all of its writes land, or none do. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
