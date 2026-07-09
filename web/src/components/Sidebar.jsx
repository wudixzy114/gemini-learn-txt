import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../store.js';
import {
  IconPlus, IconTrash, IconEdit, IconBook, IconGrip,
  IconCollapse, IconExpand,
} from './icons.jsx';

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

function ConversationItem({
  conv, active, onSelect, onDelete, onRename,
  dragging, dragOver, onDragStart, onDragEnter, onDragEnd, onDrop,
}) {
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
      className={`conv-item ${active ? 'active' : ''} ${dragging ? 'dragging' : ''} ${dragOver ? 'drag-over' : ''}`}
      onClick={() => !editing && onSelect(conv.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (!editing && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect(conv.id);
        }
      }}
      // Drag is enabled only via the handle (draggable set on the row, started
      // from the grip's onMouseDown to avoid hijacking text selection/clicks).
      draggable={!editing}
      onDragStart={(e) => onDragStart(e, conv.id)}
      onDragEnter={(e) => onDragEnter(e, conv.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => onDrop(e, conv.id)}
      onDragEnd={onDragEnd}
    >
      <span className="conv-grip" title="Drag to reorder" aria-hidden="true">
        <IconGrip width={16} height={16} />
      </span>
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

export default function Sidebar({ onNavigate, collapsed, onToggleCollapse }) {
  const conversations = useStore((s) => s.conversations);
  const activeId = useStore((s) => s.activeId);
  const loadingList = useStore((s) => s.loadingList);
  const newChat = useStore((s) => s.newChat);
  const selectConversation = useStore((s) => s.selectConversation);
  const deleteConversation = useStore((s) => s.deleteConversation);
  const renameConversation = useStore((s) => s.renameConversation);
  const reorderConversations = useStore((s) => s.reorderConversations);

  const [query, setQuery] = useState('');
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  // Mirror the dragged id in a ref so drop/commit read it synchronously — native
  // DnD events can fire faster than React re-renders, and a state-only closure
  // would see a stale (null) value on a fast drag.
  const dragIdRef = useRef(null);

  const filtered = query
    ? conversations.filter((c) =>
        c.title.toLowerCase().includes(query.toLowerCase())
      )
    : conversations;

  const select = (id) => {
    selectConversation(id);
    onNavigate?.();
  };

  // ---- Drag reorder (native DnD, no dependency) ----------------------------
  const onDragStart = (e, id) => {
    dragIdRef.current = id;
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', id); } catch { /* ignore */ }
  };
  const onDragEnter = (_e, id) => {
    if (id !== dragIdRef.current) setOverId(id);
  };
  const commitReorder = (targetId) => {
    const from = dragIdRef.current;
    if (!from || from === targetId) return;
    const ids = conversations.map((c) => c.id);
    const fromIdx = ids.indexOf(from);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    ids.splice(toIdx, 0, ids.splice(fromIdx, 1)[0]);
    reorderConversations(ids);
  };
  const onDrop = (e, id) => {
    e.preventDefault();
    commitReorder(id);
    dragIdRef.current = null;
    setDragId(null);
    setOverId(null);
  };
  const onDragEnd = () => {
    dragIdRef.current = null;
    setDragId(null);
    setOverId(null);
  };

  // Reordering only makes sense on the full, unfiltered list.
  const canReorder = !query;

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-head">
        <div className="brand">
          <span className="brand-mark"><IconBook width={20} height={20} /></span>
          <span className="brand-name">学习室<em>Study Room</em></span>
        </div>
        <button
          className="icon-btn collapse-btn"
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <IconExpand width={18} height={18} /> : <IconCollapse width={18} height={18} />}
        </button>
      </div>

      <button
        className="new-chat"
        onClick={() => { newChat(); onNavigate?.(); }}
        title="New chat"
      >
        <IconPlus width={17} height={17} />
        <span className="label-full">New chat</span>
      </button>

      {!collapsed && (
        <div className="conv-search">
          <input
            placeholder="Search chats"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      <nav className="conv-list">
        {loadingList ? (
          <div className="sidebar-hint">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="sidebar-hint">
            {query ? 'No matching chats.' : 'No chats yet.'}
          </div>
        ) : collapsed ? (
          // Collapsed rail: a letter-dot per chat (first char of the title) so
          // they stay distinguishable; click selects. Tooltip carries the title.
          filtered.map((conv) => (
            <button
              key={conv.id}
              className={`conv-dot ${conv.id === activeId ? 'active' : ''}`}
              title={conv.title}
              onClick={() => select(conv.id)}
            >
              {(conv.title || '·').trim().charAt(0) || '·'}
            </button>
          ))
        ) : (
          filtered.map((conv) => (
            <ConversationItem
              key={conv.id}
              conv={conv}
              active={conv.id === activeId}
              onSelect={select}
              onDelete={deleteConversation}
              onRename={renameConversation}
              dragging={dragId === conv.id}
              dragOver={canReorder && overId === conv.id}
              onDragStart={canReorder ? onDragStart : () => {}}
              onDragEnter={canReorder ? onDragEnter : () => {}}
              onDrop={canReorder ? onDrop : () => {}}
              onDragEnd={onDragEnd}
            />
          ))
        )}
      </nav>

      {!collapsed && (
        <div className="sidebar-foot">
          <span className="foot-dot" /> Conversations saved on this machine
        </div>
      )}
    </aside>
  );
}
