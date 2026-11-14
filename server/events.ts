import type { ServerResponse } from 'node:http';
import type { BoardEvent } from '../shared/api.ts';

/**
 * Real-time fan-out with Server-Sent Events: each open board tab holds one
 * long-lived HTTP response, and every change to that board is written to all
 * of them. SSE is one-way (server → browser), which is all a board needs,
 * since edits travel over ordinary API requests. Browsers reconnect on their
 * own if the connection drops.
 */
export class EventHub {
  private subscribers = new Map<number, Set<ServerResponse>>();

  subscribe(boardId: number, res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // stop nginx-style proxies from buffering the stream
    });
    res.write('retry: 2000\n\n');

    let set = this.subscribers.get(boardId);
    if (!set) this.subscribers.set(boardId, (set = new Set()));
    set.add(res);

    // Comment lines keep idle connections from being cut by proxies.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    res.on('close', () => {
      clearInterval(heartbeat);
      set.delete(res);
      if (set.size === 0) this.subscribers.delete(boardId);
    });
  }

  publish(boardId: number, events: BoardEvent[]): void {
    const set = this.subscribers.get(boardId);
    if (!set || events.length === 0) return;
    const frame = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
    for (const res of set) res.write(frame);
  }

  /** Disconnect everyone watching a board (e.g. it was deleted). */
  closeBoard(boardId: number): void {
    for (const res of this.subscribers.get(boardId) ?? []) res.end();
    this.subscribers.delete(boardId);
  }

  closeAll(): void {
    for (const id of [...this.subscribers.keys()]) this.closeBoard(id);
  }

  listenerCount(boardId: number): number {
    return this.subscribers.get(boardId)?.size ?? 0;
  }
}
