import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/** Text that turns into an input when clicked. Enter or blur saves; Escape cancels. */
export function InlineEdit({
  value,
  onSave,
  maxLength,
  label,
  className = '',
}: {
  value: string;
  onSave: (next: string) => void;
  maxLength: number;
  label: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== value) onSave(next);
    else setDraft(value);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') {
      setDraft(value);
      setEditing(false);
    }
  }

  if (!editing) {
    return (
      <button className={`inline-edit ${className}`} onClick={() => setEditing(true)} title={`Rename ${label}`}>
        {value}
      </button>
    );
  }
  return (
    <input
      className={`inline-edit-input ${className}`}
      aria-label={`${label} name`}
      value={draft}
      maxLength={maxLength}
      autoFocus
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKey}
    />
  );
}

/** A destructive button that asks "Sure?" on the first click instead of
 *  popping a browser dialog. */
export function ConfirmButton({
  onConfirm,
  children,
  confirmText = 'Click again to confirm',
  className = 'btn danger',
}: {
  onConfirm: () => void;
  children: ReactNode;
  confirmText?: string;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <button
      type="button"
      className={`${className}${armed ? ' armed' : ''}`}
      onClick={() => {
        if (armed) {
          clearTimeout(timer.current);
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
          timer.current = setTimeout(() => setArmed(false), 3000);
        }
      }}
    >
      {armed ? confirmText : children}
    </button>
  );
}

export function Avatar({ name }: { name: string }) {
  // Stable color per username.
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className={`avatar hue-${hash % 8}`} title={name}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
