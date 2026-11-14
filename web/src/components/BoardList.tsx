import { useEffect, useState, type FormEvent } from 'react';
import type { BoardSummary } from '../../../shared/api.ts';
import { LIMITS } from '../../../shared/api.ts';
import { api, errorMessage } from '../api.ts';

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function BoardList() {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listBoards().then(
      (r) => setBoards(r.boards),
      (err) => setError(errorMessage(err)),
    );
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const { board } = await api.createBoard(name);
      window.location.hash = `#/boards/${board.id}`;
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <section className="board-list">
      <div className="board-list-head">
        <h1>Your boards</h1>
        <form className="inline-form" onSubmit={create}>
          <input
            placeholder="New board name"
            aria-label="New board name"
            value={name}
            maxLength={LIMITS.boardName.max}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn primary" disabled={!name.trim()}>
            Create board
          </button>
        </form>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {boards === null && !error && <p className="muted">Loading…</p>}
      {boards?.length === 0 && (
        <div className="empty">
          <p>No boards yet.</p>
          <p className="muted">Create one above, or ask a teammate to invite you to theirs.</p>
        </div>
      )}
      <ul className="tiles">
        {boards?.map((b) => (
          <li key={b.id}>
            <a className="tile" href={`#/boards/${b.id}`}>
              <span className="tile-name">{b.name}</span>
              <span className="tile-meta">
                {b.cardCount} {b.cardCount === 1 ? 'card' : 'cards'} · {b.memberCount}{' '}
                {b.memberCount === 1 ? 'member' : 'members'}
              </span>
              <span className="tile-meta">
                {b.role === 'owner' ? 'Owner' : 'Member'} · updated {timeAgo(b.updatedAt)}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
