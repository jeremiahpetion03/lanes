import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardDetail, BoardEvent } from '../../shared/api.ts';
import { ApiError, api, errorMessage } from './api.ts';
import { applyEvent } from './boardState.ts';

export type BoardStatus = 'loading' | 'ready' | 'not-found' | 'deleted';

/**
 * Loads a board and keeps it in sync with the server.
 *
 * Ordering matters here. We open the live event stream *first* and fetch a
 * snapshot each time it connects (including after a reconnect). Events that
 * arrive while the snapshot is in flight are queued and replayed on top of
 * it, so nothing that happens between "fetch" and "subscribe" is lost.
 */
export function useBoard(boardId: number) {
  const [board, setBoard] = useState<BoardDetail | null>(null);
  const [status, setStatus] = useState<BoardStatus>('loading');
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<BoardEvent[] | null>(null);

  const reload = useCallback(async () => {
    pending.current = [];
    try {
      const { board: snapshot } = await api.getBoard(boardId);
      const queued = pending.current ?? [];
      pending.current = null;
      setBoard(queued.reduce(applyEvent, snapshot));
      setStatus('ready');
    } catch (err) {
      pending.current = null;
      if (err instanceof ApiError && err.status === 404) setStatus('not-found');
      else setError(errorMessage(err));
    }
  }, [boardId]);

  useEffect(() => {
    setBoard(null);
    setStatus('loading');
    const source = new EventSource(`/api/boards/${boardId}/events`);
    source.onopen = () => {
      setLive(true);
      void reload();
    };
    source.onerror = () => setLive(false);
    source.onmessage = (msg) => {
      const event = JSON.parse(msg.data as string) as BoardEvent;
      if (event.type === 'board.deleted') {
        source.close();
        setStatus('deleted');
        return;
      }
      if (pending.current) pending.current.push(event);
      else setBoard((b) => (b ? applyEvent(b, event) : b));
    };
    return () => source.close();
  }, [boardId, reload]);

  /**
   * Optimistic update: change the screen immediately, then send the request.
   * If the server rejects it, show why and re-sync from the server.
   */
  const mutate = useCallback(
    async (local: ((b: BoardDetail) => BoardDetail) | null, request: () => Promise<unknown>) => {
      if (local) setBoard((b) => (b ? local(b) : b));
      try {
        return await request();
      } catch (err) {
        setError(errorMessage(err));
        await reload();
        return undefined;
      }
    },
    [reload],
  );

  return { board, setBoard, status, live, error, clearError: () => setError(null), mutate };
}
