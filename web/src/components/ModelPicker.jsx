import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';
import { IconChevronDown, IconCheck } from './icons.jsx';

// Compact model switcher for the topbar. The choice is per-conversation and
// takes effect on the next turn; it's disabled while a reply is streaming.
export default function ModelPicker() {
  const models = useStore((s) => s.models);
  const activeModel = useStore((s) => s.activeModel);
  const setModel = useStore((s) => s.setModel);
  const streaming = useStore((s) => s.streaming);

  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!models.length) return null;

  const current = models.find((m) => m.id === activeModel) || models[0];

  const pick = (id) => {
    setOpen(false);
    setModel(id);
  };

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        className="model-pill"
        onClick={() => setOpen((v) => !v)}
        disabled={streaming}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={streaming ? 'Finish the reply to switch models' : 'Switch model'}
      >
        <span className="model-pill-label">{current.label}</span>
        <IconChevronDown className={`model-caret ${open ? 'open' : ''}`} width={15} height={15} />
      </button>
      {open && (
        <ul className="model-menu" role="listbox">
          {models.map((m) => {
            const selected = m.id === current.id;
            return (
              <li key={m.id} role="option" aria-selected={selected}>
                <button
                  className={`model-option ${selected ? 'selected' : ''}`}
                  onClick={() => pick(m.id)}
                >
                  <span className="model-check" aria-hidden="true">
                    {selected && <IconCheck width={15} height={15} />}
                  </span>
                  <span className="model-option-text">
                    <span className="model-option-label">{m.label}</span>
                    {m.blurb && <span className="model-option-blurb">{m.blurb}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
