import { useEffect, useState } from 'react';
import type { User } from '../../shared/api.ts';
import { api } from './api.ts';
import { AuthForm } from './components/AuthForm.tsx';
import { BoardList } from './components/BoardList.tsx';
import { BoardView } from './components/BoardView.tsx';

/** Tiny hash router: `#/boards/12` shows board 12, anything else the list. */
function useRoute(): { boardId: number | null } {
  const read = () => {
    const m = window.location.hash.match(/^#\/boards\/(\d+)$/);
    return { boardId: m ? Number(m[1]) : null };
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function App() {
  // undefined = still checking the session, null = logged out
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const { boardId } = useRoute();

  useEffect(() => {
    api.me().then(
      (r) => setUser(r.user),
      () => setUser(null),
    );
  }, []);

  async function logout() {
    await api.logout().catch(() => {});
    setUser(null);
    window.location.hash = '';
  }

  if (user === undefined) return <div className="splash">Loading…</div>;
  if (user === null) return <AuthForm onAuthed={setUser} />;

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="brand-mark" aria-hidden="true" />
          Lanes
        </a>
        <div className="topbar-right">
          <span className="whoami">@{user.username}</span>
          <button className="btn ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      <main>{boardId ? <BoardView key={boardId} boardId={boardId} user={user} /> : <BoardList />}</main>
    </div>
  );
}
