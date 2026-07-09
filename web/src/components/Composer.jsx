import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useStore } from '../store.js';
import { IconSend, IconStop } from './icons.jsx';

export default function Composer() {
  const [value, setValue] = useState('');
  const taRef = useRef(null);
  const streaming = useStore((s) => s.streaming);
  const send = useStore((s) => s.send);
  const stop = useStore((s) => s.stopGeneration);
  const activeId = useStore((s) => s.activeId);

  const autosize = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 220) + 'px';
  }, []);

  useEffect(autosize, [value, autosize]);

  // Global shortcut: Shift+Enter focuses the composer so the user can start
  // typing without reaching for the mouse. Guarded to fire only when focus is
  // NOT already in an editable field — otherwise it would hijack the composer's
  // own Shift+Enter (newline) and the sidebar's rename input.
  useEffect(() => {
    const isEditable = (el) => {
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };
    const onKey = (e) => {
      if (e.key !== 'Enter' || !e.shiftKey) return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent?.isComposing) return;
      // Check the event's origin element, not document.activeElement — focus can
      // move mid-event (e.g. the sidebar rename input commits + unmounts on Enter
      // before this bubble-phase listener runs), but e.target stays stable.
      if (isEditable(e.target)) return;
      e.preventDefault();
      const ta = taRef.current;
      if (ta) {
        ta.focus();
        const end = ta.value.length;
        ta.setSelectionRange(end, end);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = () => {
    const text = value.trim();
    if (!text || streaming || !activeId) return;
    send(text);
    setValue('');
    requestAnimationFrame(() => {
      if (taRef.current) taRef.current.style.height = 'auto';
    });
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          ref={taRef}
          className="composer-input"
          placeholder="Ask anything, or paste something to learn…"
          value={value}
          rows={1}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {streaming ? (
          <button className="send-btn stop" onClick={stop} title="Stop generating">
            <IconStop width={18} height={18} />
          </button>
        ) : (
          <button
            className="send-btn"
            onClick={submit}
            disabled={!value.trim()}
            title="Send (Enter)"
          >
            <IconSend width={18} height={18} />
          </button>
        )}
      </div>
      <div className="composer-hint">
        <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
      </div>
    </div>
  );
}
