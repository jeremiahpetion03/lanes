import { useCallback, useState, type FormEvent } from 'react';
import type { User } from '../../../shared/api.ts';
import { LIMITS } from '../../../shared/api.ts';
import { api, errorMessage } from '../api.ts';
import { applyEvent, cardsIn, moveCardLocally, sortedColumns, updateCardLocally } from '../boardState.ts';
import { useBoard } from '../useBoard.ts';
import { CardModal } from './CardModal.tsx';
import { ColumnView } from './ColumnView.tsx';
import { Avatar, ConfirmButton, InlineEdit } from './controls.tsx';

export function BoardView({ boardId, user }: { boardId: number; user: User }) {
  const { board, setBoard, status, live, error, clearError, mutate } = useBoard(boardId);
  const [openCardId, setOpenCardId] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ columnId: number; index: number } | null>(null);
  const [newColumn, setNewColumn] = useState('');
  const [invite, setInvite] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);

  const closeModal = useCallback(() => setOpenCardId(null), []);

  if (status === 'not-found' || status === 'deleted') {
    return (
      <div className="empty">
        <p>{status === 'deleted' ? 'This board was deleted.' : "This board doesn't exist, or you don't have access."}</p>
        <a className="btn primary" href="#/">
          Back to your boards
        </a>
      </div>
    );
  }
  if (!board) return <p className="muted pad">Loading board…</p>;

  const columns = sortedColumns(board);
  const openCard = board.cards.find((c) => c.id === openCardId);

  function moveCard(cardId: number, columnId: number, index: number) {
    void mutate(
      (b) => moveCardLocally(b, cardId, columnId, index),
      () => api.moveCard(cardId, columnId, index),
    );
  }

  async function addColumn(e: FormEvent) {
    e.preventDefault();
    const name = newColumn.trim();
    if (!name) return;
    setNewColumn('');
    await mutate(null, async () => {
      const { column } = await api.createColumn(boardId, name);
      setBoard((b) => b && applyEvent(b, { type: 'column.upserted', column }));
    });
  }

  async function inviteMember(e: FormEvent) {
    e.preventDefault();
    setInviteError(null);
    try {
      const { member } = await api.addMember(boardId, invite.trim());
      setBoard((b) => b && applyEvent(b, { type: 'member.added', member }));
      setInvite('');
    } catch (err) {
      setInviteError(errorMessage(err));
    }
  }

  return (
    <div className="board">
      <div className="board-head">
        <a className="back" href="#/" aria-label="Back to boards">
          ←
        </a>
        <InlineEdit
          className="board-title"
          value={board.name}
          label="board"
          maxLength={LIMITS.boardName.max}
          onSave={(name) =>
            void mutate(
              (b) => ({ ...b, name }),
              () => api.renameBoard(boardId, name),
            )
          }
        />
        <span className={`live ${live ? 'on' : 'off'}`} title={live ? 'Changes from others appear instantly' : ''}>
          {live ? 'Live' : 'Reconnecting…'}
        </span>
        <span className="spacer" />
        <div className="members" aria-label="Board members">
          {board.members.map((m) => (
            <Avatar key={m.userId} name={m.username} />
          ))}
        </div>
        {board.role === 'owner' && (
          <>
            <form className="inline-form compact" onSubmit={inviteMember}>
              <input
                placeholder="Invite by username"
                aria-label="Invite by username"
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
              />
              <button className="btn small" disabled={!invite.trim()}>
                Invite
              </button>
            </form>
            <ConfirmButton
              className="btn danger small"
              confirmText="Delete board?"
              onConfirm={() =>
                void api.deleteBoard(boardId).then(
                  () => (window.location.hash = '#/'),
                  (err) => setInviteError(errorMessage(err)),
                )
              }
            >
              Delete
            </ConfirmButton>
          </>
        )}
      </div>

      {(error || inviteError) && (
        <div className="banner" role="alert">
          {error ?? inviteError}
          <button
            className="icon-btn"
            aria-label="Dismiss"
            onClick={() => {
              clearError();
              setInviteError(null);
            }}
          >
            ×
          </button>
        </div>
      )}

      <div className="columns">
        {columns.map((col) => (
          <ColumnView
            key={col.id}
            column={col}
            cards={cardsIn(board, col.id)}
            draggingId={dragging}
            dropIndex={dropTarget?.columnId === col.id ? dropTarget.index : null}
            onDragStart={setDragging}
            onDragEnd={() => {
              setDragging(null);
              setDropTarget(null);
            }}
            onDragOverIndex={(index) => setDropTarget(index === null ? null : { columnId: col.id, index })}
            onDrop={(index) => {
              if (dragging !== null) moveCard(dragging, col.id, index);
              setDragging(null);
              setDropTarget(null);
            }}
            onOpenCard={setOpenCardId}
            onAddCard={(title) =>
              mutate(null, async () => {
                const { card } = await api.createCard(col.id, title);
                setBoard((b) => b && applyEvent(b, { type: 'card.upserted', card }));
              })
            }
            onRename={(name) =>
              void mutate(
                (b) => ({ ...b, columns: b.columns.map((c) => (c.id === col.id ? { ...c, name } : c)) }),
                () => api.renameColumn(col.id, name),
              )
            }
            onDelete={() =>
              void mutate(
                (b) => applyEvent(b, { type: 'column.deleted', columnId: col.id }),
                () => api.deleteColumn(col.id),
              )
            }
          />
        ))}

        <form className="column add-column" onSubmit={addColumn}>
          <input
            placeholder="+ Add a column"
            aria-label="New column name"
            value={newColumn}
            maxLength={LIMITS.columnName.max}
            onChange={(e) => setNewColumn(e.target.value)}
          />
          {newColumn.trim() && <button className="btn primary small">Add column</button>}
        </form>
      </div>

      {openCard && (
        <CardModal
          key={openCard.id}
          card={openCard}
          columns={columns}
          onClose={closeModal}
          onSave={(patch) =>
            void mutate(
              (b) => updateCardLocally(b, openCard.id, patch),
              () => api.updateCard(openCard.id, patch),
            )
          }
          onMove={(columnId) =>
            // to the bottom of the chosen column
            moveCard(openCard.id, columnId, cardsIn(board, columnId).filter((c) => c.id !== openCard.id).length)
          }
          onDelete={() => {
            setOpenCardId(null);
            void mutate(
              (b) => applyEvent(b, { type: 'card.deleted', cardId: openCard.id }),
              () => api.deleteCard(openCard.id),
            );
          }}
        />
      )}
      <p className="sr-only">Signed in as {user.username}</p>
    </div>
  );
}
