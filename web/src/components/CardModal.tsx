import { useEffect, useState, type FormEvent } from 'react';
import type { Card, Column } from '../../../shared/api.ts';
import { LIMITS } from '../../../shared/api.ts';
import { ConfirmButton } from './controls.tsx';

interface Props {
  card: Card;
  columns: Column[];
  onSave: (patch: { title: string; description: string }) => void;
  onMove: (columnId: number) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function CardModal({ card, columns, onSave, onMove, onDelete, onClose }: Props) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dirty = title.trim() !== card.title || description !== card.description;

  function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (dirty) onSave({ title: title.trim(), description });
    onClose();
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" role="dialog" aria-modal="true" aria-label="Edit card" onSubmit={save}>
        <label>
          Title
          <input
            value={title}
            maxLength={LIMITS.cardTitle.max}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </label>
        <label>
          Description
          <textarea
            rows={6}
            value={description}
            maxLength={LIMITS.cardDescription.max}
            placeholder="Add details, links, acceptance criteria…"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label>
          Column
          <select value={card.columnId} onChange={(e) => onMove(Number(e.target.value))}>
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">
          Created by @{card.createdBy} · last changed {new Date(card.updatedAt).toLocaleString()}
        </p>
        <div className="modal-actions">
          <ConfirmButton onConfirm={onDelete} confirmText="Really delete?">
            Delete card
          </ConfirmButton>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!title.trim()}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
