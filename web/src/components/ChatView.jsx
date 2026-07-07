import React, { useEffect, useRef } from 'react';
import { useStore } from '../store.js';
import Message from './Message.jsx';
import Composer from './Composer.jsx';

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
  const send = useStore((s) => s.send);

  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  const pinnedRef = useRef(true);

  // Track whether the user is pinned to the bottom; only auto-scroll if so.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedRef.current = distance < 120;
  };

  useEffect(() => {
    if (pinnedRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: streaming ? 'auto' : 'smooth' });
    }
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
            <div ref={bottomRef} />
          </div>
        )}
      </div>
      <Composer />
    </div>
  );
}
