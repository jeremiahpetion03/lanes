import { useState, type DragEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { Card, Column } from '../../../shared/api.ts';
import { LIMITS } from '../../../shared/api.ts';
import { ConfirmButton, InlineEdit } from './controls.tsx';

interface Props {
  column: Column;
  cards: Card[];
  draggingId: number | null;
  dropIndex: number | null;
  onDragStart: (cardId: number) => void;
  onDragEnd: () => void;
  onDragOverIndex: (index: number | null) => void;
  onDrop: (index: number) => void;
  onOpenCard: (cardId: number) => void;
  onAddCard: (title: string) => Promise<unknown>;
  onRename: (name: string) => void;
  onDelete: () => void;
}

export function ColumnView(props: Props) {
  const { column, cards, draggingId, dropIndex } = props;
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');

  /** Where would the card land if dropped at this mouse position? Counted
   *  among the *other* cards, matching what the move API expects. */
  function indexAt(e: DragEvent<HTMLElement>): number {
    const others = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-card-id]')].filter(
      (el) => Number(el.dataset.cardId) !== draggingId,
    );
    const i = others.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    return i === -1 ? others.length : i;
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const t = title.trim();
    if (!t) return;
    setTitle('');
    await props.onAddCard(t);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
    if (e.key === 'Escape') {
      setAdding(false);
      setTitle('');
    }
  }

  const items: ReactNode[] = [];
  let k = 0;
  const indicator = <li key="drop" className="drop-indicator" aria-hidden="true" />;
  for (const card of cards) {
    if (card.id !== draggingId) {
      if (dropIndex === k) items.push(indicator);
      k++;
    }
    items.push(
      <li
        key={card.id}
        data-card-id={card.id}
        className={`card${card.id === draggingId ? ' dragging' : ''}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', String(card.id));
          e.dataTransfer.effectAllowed = 'move';
          props.onDragStart(card.id);
        }}
        onDragEnd={props.onDragEnd}
      >
        <button className="card-button" onClick={() => props.onOpenCard(card.id)}>
          <span className="card-title">{card.title}</span>
          {card.description && <span className="card-has-notes" title="Has a description" />}
        </button>
      </li>,
    );
  }
  if (dropIndex === k) items.push(indicator);

  return (
    <section className="column" aria-label={column.name}>
      <header className="column-head">
        <InlineEdit value={column.name} onSave={props.onRename} maxLength={LIMITS.columnName.max} label="column" />
        <span className="count">{cards.length}</span>
        <ConfirmButton className="icon-btn" confirmText="Delete?" onConfirm={props.onDelete}>
          <span aria-label={`Delete column ${column.name}`}>×</span>
        </ConfirmButton>
      </header>

      <ul
        className={`card-list${dropIndex !== null ? ' drop-active' : ''}`}
        onDragOver={(e) => {
          if (draggingId === null) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const i = indexAt(e);
          if (i !== dropIndex) props.onDragOverIndex(i);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) props.onDragOverIndex(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (draggingId !== null) props.onDrop(indexAt(e));
        }}
      >
        {items}
      </ul>

      {adding ? (
        <form className="add-card" onSubmit={submit}>
          <textarea
            autoFocus
            aria-label="Card title"
            placeholder="What needs doing?"
            value={title}
            maxLength={LIMITS.cardTitle.max}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={onKey}
          />
          <div className="row">
            <button className="btn primary small" disabled={!title.trim()}>
              Add card
            </button>
            <button type="button" className="btn ghost small" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button className="add-card-toggle" onClick={() => setAdding(true)}>
          + Add a card
        </button>
      )}
    </section>
  );
}
