import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BoardDetail, Card } from '../shared/api.ts';
import { applyEvent, cardsIn, moveCardLocally } from '../web/src/boardState.ts';

const card = (id: number, columnId: number, position: number): Card => ({
  id,
  boardId: 1,
  columnId,
  title: `card ${id}`,
  description: '',
  position,
  createdBy: 'ada',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const board = (): BoardDetail => ({
  id: 1,
  name: 'B',
  role: 'owner',
  columns: [
    { id: 10, boardId: 1, name: 'To do', position: 1024 },
    { id: 20, boardId: 1, name: 'Done', position: 2048 },
  ],
  cards: [card(1, 10, 1024), card(2, 10, 2048), card(3, 10, 3072)],
  members: [{ userId: 1, username: 'ada', role: 'owner' }],
});

const ids = (b: BoardDetail, col: number) => cardsIn(b, col).map((c) => c.id);

test('moving locally matches the server rule', () => {
  let b = moveCardLocally(board(), 3, 10, 0);
  assert.deepEqual(ids(b, 10), [3, 1, 2]);
  b = moveCardLocally(b, 1, 20, 0);
  assert.deepEqual(ids(b, 10), [3, 2]);
  assert.deepEqual(ids(b, 20), [1]);
});

test('events are idempotent: applying one twice changes nothing more', () => {
  const event = { type: 'card.upserted', card: card(4, 20, 1024) } as const;
  const once = applyEvent(board(), event);
  assert.deepEqual(applyEvent(once, event), once);
  const member = { type: 'member.added', member: { userId: 2, username: 'bo', role: 'member' } } as const;
  assert.equal(applyEvent(applyEvent(board(), member), member).members.length, 2);
});

test("deleting a column removes its cards from the screen", () => {
  const b = applyEvent(board(), { type: 'column.deleted', columnId: 10 });
  assert.equal(b.columns.length, 1);
  assert.equal(b.cards.length, 0);
});

test('applyEvent never mutates the previous state (React relies on this)', () => {
  const before = board();
  const snapshot = structuredClone(before);
  applyEvent(before, { type: 'card.deleted', cardId: 1 });
  moveCardLocally(before, 1, 20, 0);
  assert.deepEqual(before, snapshot);
});
