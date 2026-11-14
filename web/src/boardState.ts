// Pure functions over board state. No React, no network, so they're easy to
// unit test and they behave the same for local edits and for live events.

import type { BoardDetail, BoardEvent, Card } from '../../shared/api.ts';
import { positionBetween } from '../../shared/ordering.ts';

function upsert<T extends { id: number }>(items: T[], item: T): T[] {
  const i = items.findIndex((x) => x.id === item.id);
  if (i === -1) return [...items, item];
  const copy = items.slice();
  copy[i] = item;
  return copy;
}

/**
 * Apply a server event. Events carry the full updated object, so applying
 * the same event twice, or an event for a change this tab already made
 * optimistically, is harmless.
 */
export function applyEvent(board: BoardDetail, event: BoardEvent): BoardDetail {
  switch (event.type) {
    case 'board.updated':
      return { ...board, name: event.board.name };
    case 'board.deleted':
      return board;
    case 'column.upserted':
      return { ...board, columns: upsert(board.columns, event.column) };
    case 'column.deleted':
      return {
        ...board,
        columns: board.columns.filter((c) => c.id !== event.columnId),
        cards: board.cards.filter((c) => c.columnId !== event.columnId),
      };
    case 'card.upserted':
      return { ...board, cards: upsert(board.cards, event.card) };
    case 'card.deleted':
      return { ...board, cards: board.cards.filter((c) => c.id !== event.cardId) };
    case 'member.added':
      return board.members.some((m) => m.userId === event.member.userId)
        ? board
        : { ...board, members: [...board.members, event.member] };
  }
}

export const sortedColumns = (board: BoardDetail) => [...board.columns].sort((a, b) => a.position - b.position);

export const cardsIn = (board: BoardDetail, columnId: number): Card[] =>
  board.cards.filter((c) => c.columnId === columnId).sort((a, b) => a.position - b.position);

/** Optimistically move a card, using the same rule the server uses. */
export function moveCardLocally(board: BoardDetail, cardId: number, columnId: number, index: number): BoardDetail {
  const siblings = cardsIn(board, columnId).filter((c) => c.id !== cardId);
  const i = Math.min(index, siblings.length);
  const position = positionBetween(siblings[i - 1]?.position, siblings[i]?.position);
  return {
    ...board,
    cards: board.cards.map((c) => (c.id === cardId ? { ...c, columnId, position } : c)),
  };
}

export function updateCardLocally(board: BoardDetail, cardId: number, patch: Partial<Card>): BoardDetail {
  return { ...board, cards: board.cards.map((c) => (c.id === cardId ? { ...c, ...patch } : c)) };
}
