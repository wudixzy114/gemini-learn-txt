import React, { useState, useCallback } from 'react';
import { Markdown } from './Markdown.jsx';
import { IconCopy, IconCheck, IconBook } from './icons.jsx';

function MessageActions({ content }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* ignore */ }
  }, [content]);
  return (
    <div className="msg-actions">
      <button className="ghost-btn" onClick={copy} type="button">
        {copied ? <IconCheck width={14} height={14} /> : <IconCopy width={14} height={14} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

// Collapsible reasoning ("thinking") block shown above the answer. While the
// model is still thinking (reasoning streaming, no answer yet) it stays open;
// once the answer starts it can be collapsed to keep the transcript readable.
function Reasoning({ text, active }) {
  const [open, setOpen] = useState(false);
  const show = open || active;
  return (
    <div className={`reasoning ${show ? 'open' : ''}`}>
      <button
        className="reasoning-toggle"
        onClick={() => setOpen((v) => !v)}
        type="button"
        aria-expanded={show}
      >
        <span className={`reasoning-caret ${show ? 'open' : ''}`} aria-hidden="true">›</span>
        {active ? 'Thinking…' : 'Thought process'}
      </button>
      {show && (
        <div className="reasoning-body">
          <Markdown content={text} />
        </div>
      )}
    </div>
  );
}

export default function Message({ message, streaming }) {
  const isUser = message.role === 'user';
  const empty = !message.content;
  const hasReasoning = !isUser && !!message.reasoning;
  // The thinking phase is "active" while reasoning is streaming but the answer
  // hasn't begun yet — keep the block open then so the user sees live thinking.
  const thinkingActive = streaming && hasReasoning && empty;

  return (
    <div className={`msg-row ${isUser ? 'user' : 'assistant'}`}>
      <div className="msg-inner">
        <div className="msg-avatar" aria-hidden="true">
          {isUser ? <span className="avatar-user">You</span> : <IconBook width={17} height={17} />}
        </div>
        <div className="msg-body">
          <div className="msg-name">{isUser ? 'You' : 'Study Room'}</div>
          {isUser ? (
            <div className="user-text">{message.content}</div>
          ) : (
            <>
              {hasReasoning && <Reasoning text={message.reasoning} active={thinkingActive} />}
              {empty && streaming ? (
                !hasReasoning && (
                  <div className="typing" aria-label="Assistant is typing">
                    <span></span><span></span><span></span>
                  </div>
                )
              ) : (
                <>
                  <Markdown content={message.content} />
                  {streaming && <span className="stream-caret" aria-hidden="true" />}
                </>
              )}
            </>
          )}
          {!isUser && !empty && !streaming && <MessageActions content={message.content} />}
        </div>
      </div>
    </div>
  );
}
