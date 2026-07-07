import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../store.js';
import { IconPlus, IconTrash, IconEdit, IconBook, IconCheck } from './icons.jsx';

function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

function ConversationItem({ conv, active, onSelect, onDelete, onRename }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conv.title);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== conv.title) onRename(conv.id, draft);
    else setDraft(conv.title);
  };

  return (
    <div
      className={`conv-item ${active ? 'active' : ''}`}
      onClick={() => !editing && onSelect(conv.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (!editing && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect(conv.id);
        }
      }}
    >
      <div className="conv-main">
        {editing ? (
          <input
            ref={inputRef}
            className="conv-rename"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setDraft(conv.title);
                setEditing(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <span className="conv-title">{conv.title}</span>
            <span className="conv-meta">{timeAgo(conv.updatedAt)}</span>
          </>
        )}
      </div>
      {!editing && (
        <div className="conv-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="icon-btn tiny"
            title="Rename"
            onClick={() => {
              setDraft(conv.title);
              setEditing(true);
            }}
          >
            <IconEdit width={15} height={15} />
          </button>
          <button
            className="icon-btn tiny danger"
            title="Delete"
            onClick={() => {
              if (confirm(`Delete "${conv.title}"?`)) onDelete(conv.id);
            }}
          >
            <IconTrash width={15} height={15} />
          </button>
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ onNavigate }) {
  const conversations = useStore((s) => s.conversations);
  const activeId = useStore((s) => s.activeId);
  const loadingList = useStore((s) => s.loadingList);
  const newChat = useStore((s) => s.newChat);
  const selectConversation = useStore((s) => s.selectConversation);
  const deleteConversation = useStore((s) => s.deleteConversation);
  const renameConversation = useStore((s) => s.renameConversation);

  const [query, setQuery] = useState('');
  const filtered = query
    ? conversations.filter((c) =>
        c.title.toLowerCase().includes(query.toLowerCase())
      )
    : conversations;

  const select = (id) => {
    selectConversation(id);
    onNavigate?.();
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark"><IconBook width={20} height={20} /></span>
        <span className="brand-name">学习室<em>Study Room</em></span>
      </div>

      <button className="new-chat" onClick={() => { newChat(); onNavigate?.(); }}>
        <IconPlus width={17} height={17} />
        <span>New chat</span>
      </button>

      <div className="conv-search">
        <input
          placeholder="Search chats"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <nav className="conv-list">
        {loadingList ? (
          <div className="sidebar-hint">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="sidebar-hint">
            {query ? 'No matching chats.' : 'No chats yet.'}
          </div>
        ) : (
          filtered.map((conv) => (
            <ConversationItem
              key={conv.id}
              conv={conv}
              active={conv.id === activeId}
              onSelect={select}
              onDelete={deleteConversation}
              onRename={renameConversation}
            />
          ))
        )}
      </nav>

      <div className="sidebar-foot">
        <span className="foot-dot" /> Conversations saved on this machine
      </div>
    </aside>
  );
}
