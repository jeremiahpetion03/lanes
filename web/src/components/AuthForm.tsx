import { useState, type FormEvent } from 'react';
import type { User } from '../../../shared/api.ts';
import { LIMITS } from '../../../shared/api.ts';
import { ApiError, api, errorMessage } from '../api.ts';

export function AuthForm({ onAuthed }: { onAuthed: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = mode === 'login' ? await api.login(username, password) : await api.register(username, password);
      onAuthed(user);
    } catch (err) {
      setError({ message: errorMessage(err), field: err instanceof ApiError ? err.field : undefined });
    } finally {
      setBusy(false);
    }
  }

  const registering = mode === 'register';
  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit} noValidate>
        <div className="brand big">
          <span className="brand-mark" aria-hidden="true" />
          Lanes
        </div>
        <p className="muted">{registering ? 'Create an account to start a board.' : 'Welcome back.'}</p>

        <label>
          Username
          <input
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-invalid={error?.field === 'username'}
            maxLength={LIMITS.username.max}
            autoFocus
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={registering ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error?.field === 'password'}
            maxLength={LIMITS.password.max}
          />
        </label>
        {registering && <p className="hint">At least {LIMITS.password.min} characters.</p>}
        {error && (
          <p className="error" role="alert">
            {error.message}
          </p>
        )}

        <button className="btn primary wide" disabled={busy || !username || !password}>
          {busy ? 'One moment…' : registering ? 'Create account' : 'Log in'}
        </button>
        <button
          type="button"
          className="btn link"
          onClick={() => {
            setMode(registering ? 'login' : 'register');
            setError(null);
          }}
        >
          {registering ? 'Have an account? Log in' : 'New here? Create an account'}
        </button>
      </form>
    </div>
  );
}
