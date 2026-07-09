import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';
import Message from './Message.jsx';
import Composer from './Composer.jsx';
import { IconArrowDown } from './icons.jsx';

const SUGGESTIONS = [
  { t: 'Explain a concept', d: 'Explain the transformer attention mechanism with an analogy.' },
  { t: 'Learn by example', d: 'Teach me Python list comprehensions with 3 progressive examples.' },
  { t: 'Work through math', d: 'Walk me through solving ∫ x·eˣ dx step by step.' },
  { t: 'Review my thinking', d: 'I think recursion is just loops. Where am I wrong?' },
];

function EmptyState({ onPick }) {
  return (
    <div className="empty-state">
      <div className="empty-hero">
        <h1>What would you like to learn today?</h1>
        <p>A quiet room for asking, exploring, and thinking things through.</p>
      </div>
      <div className="suggestions">
        {SUGGESTIONS.map((s) => (
          <button key={s.t} className="suggestion" onClick={() => onPick(s.d)}>
            <span className="suggestion-t">{s.t}</span>
            <span className="suggestion-d">{s.d}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ChatView() {
  const messages = useStore((s) => s.messages);
  const streaming = useStore((s) => s.streaming);
  const loading = useStore((s) => s.loadingConversation);
  const streamError = useStore((s) => s.streamError);
  const activeId = useStore((s) => s.activeId);
  const send = useStore((s) => s.send);

  const scrollRef = useRef(null);
  const positions = useRef(new Map()); // conversation id -> saved scrollTop
  const shownIdRef = useRef(null); // which conversation is currently positioned
  const restoringRef = useRef(false); // suppress saves during programmatic scroll
  const prevCountRef = useRef(messages.length);
  const [showJump, setShowJump] = useState(false);

  const BOTTOM_GAP = 120; // px from the bottom still counted as "at bottom"

  const nearBottom = () => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_GAP;
  };

  const scrollToBottom = (behavior = 'smooth') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  };

  // Remember each conversation's scroll position and toggle the jump button.
  // Skip while restoring (programmatic scroll) or loading (the message list is
  // briefly swapped for a placeholder, which would save a bogus scrollTop).
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || restoringRef.current || loading) return;
    if (shownIdRef.current != null) positions.current.set(shownIdRef.current, el.scrollTop);
    setShowJump(!nearBottom());
  };

  // Position the view when the active conversation changes (restore its saved
  // anchor, or land at the bottom for a fresh one) and when a new message is
  // appended (a send — jump so it's visible). Streaming deltas only grow the
  // last message's content without changing the count, so nothing fires here
  // and the view stays anchored wherever the reader left it.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || loading) return;

    if (shownIdRef.current !== activeId) {
      restoringRef.current = true;
      const saved = positions.current.get(activeId);
      // 'instant' (not 'auto') so the restore jumps immediately — 'auto' defers
      // to the container's CSS scroll-behavior: smooth, which would animate the
      // tab switch.
      el.scrollTo({ top: saved != null ? saved : el.scrollHeight, behavior: 'instant' });
      shownIdRef.current = activeId;
      prevCountRef.current = messages.length;
      setShowJump(!nearBottom());
      requestAnimationFrame(() => { restoringRef.current = false; });
      return;
    }

    if (messages.length > prevCountRef.current) {
      scrollToBottom('auto');
      setShowJump(false);
    }
    prevCountRef.current = messages.length;
  }, [activeId, loading, messages.length]);

  // As content streams in, scrollHeight grows while scrollTop stays put, so the
  // reader drifts above the fold without a scroll event — keep the button synced.
  useEffect(() => {
    if (!restoringRef.current) setShowJump(!nearBottom());
  }, [messages, streaming]);

  const isEmpty = !loading && messages.length === 0;

  return (
    <div className="chat-view">
      <div className="messages" ref={scrollRef} onScroll={onScroll}>
        {loading ? (
          <div className="center-note">Loading conversation…</div>
        ) : isEmpty ? (
          <EmptyState onPick={(d) => send(d)} />
        ) : (
          <div className="messages-inner">
            {messages.map((m, i) => (
              <Message
                key={m.id}
                message={m}
                streaming={streaming && i === messages.length - 1 && m.role === 'assistant'}
              />
            ))}
            {streamError && (
              <div className="error-banner" role="alert">
                <strong>Couldn’t complete that.</strong> {streamError}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="composer-region">
        {showJump && !isEmpty && (
          <button
            className="jump-bottom"
            onClick={() => scrollToBottom('smooth')}
            aria-label="Scroll to latest"
            title="Scroll to latest"
          >
            <IconArrowDown width={18} height={18} />
          </button>
        )}
        <Composer />
      </div>
    </div>
  );
}
