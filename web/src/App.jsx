import React, { useEffect, useState } from 'react';
import { useStore } from './store.js';
import Sidebar from './components/Sidebar.jsx';
import ChatView from './components/ChatView.jsx';
import ModelPicker from './components/ModelPicker.jsx';
import { IconSun, IconMoon, IconMenu, IconDownload } from './components/icons.jsx';
import { downloadConversationMarkdown } from './export.js';

// Below this width (but above the 820px mobile drawer breakpoint) the 288px
// sidebar crowds the reading column, so we auto-collapse it to the icon rail.
const NARROW_QUERY = '(max-width: 1024px)';
const isNarrow = () => {
  try { return window.matchMedia(NARROW_QUERY).matches; } catch { return false; }
};
const savedCollapsed = () => {
  try { return localStorage.getItem('sidebarCollapsed') === '1'; } catch { return false; }
};

function useTheme() {
  const [theme, setTheme] = useState(
    () => document.documentElement.getAttribute('data-theme') || 'light'
  );
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('theme', theme);
    } catch { /* ignore */ }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'light' ? 'dark' : 'light'))];
}

export default function App() {
  const init = useStore((s) => s.init);
  const conversations = useStore((s) => s.conversations);
  const activeId = useStore((s) => s.activeId);
  const messages = useStore((s) => s.messages);
  const [theme, toggleTheme] = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Collapsed if the user saved that preference, or the window starts narrow.
  const [collapsed, setCollapsed] = useState(() => savedCollapsed() || isNarrow());

  const toggleCollapse = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem('sidebarCollapsed', next ? '1' : '0');
      } catch { /* ignore */ }
      return next;
    });
  };

  // Auto-collapse when the window narrows; when it widens again, restore the
  // user's saved manual preference rather than forcing the sidebar open.
  useEffect(() => {
    let mql;
    try { mql = window.matchMedia(NARROW_QUERY); } catch { return; }
    const onChange = (e) => setCollapsed(e.matches ? true : savedCollapsed());
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    init();
  }, [init]);

  const active = conversations.find((c) => c.id === activeId);

  return (
    <div className={`app ${sidebarOpen ? 'sidebar-open' : ''} ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />
      <Sidebar
        onNavigate={() => setSidebarOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
      />

      <main className="main">
        <header className="topbar">
          <button
            className="icon-btn menu-btn"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle sidebar"
          >
            <IconMenu width={20} height={20} />
          </button>
          <ModelPicker />
          <div className="topbar-title" title={active?.title}>
            {active?.title || 'New chat'}
          </div>
          <button
            className="icon-btn"
            onClick={() => active && downloadConversationMarkdown(active, messages)}
            disabled={!active || messages.length === 0}
            aria-label="Export conversation"
            title="Export conversation as Markdown"
          >
            <IconDownload width={19} height={19} />
          </button>
          <button
            className="icon-btn"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            title={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
          >
            {theme === 'light' ? <IconMoon width={19} height={19} /> : <IconSun width={19} height={19} />}
          </button>
        </header>

        <ChatView />
      </main>
    </div>
  );
}
