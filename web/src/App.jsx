import React, { useEffect, useState } from 'react';
import { useStore } from './store.js';
import Sidebar from './components/Sidebar.jsx';
import ChatView from './components/ChatView.jsx';
import { IconSun, IconMoon, IconMenu } from './components/icons.jsx';

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
  const [theme, toggleTheme] = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    init();
  }, [init]);

  const active = conversations.find((c) => c.id === activeId);

  return (
    <div className={`app ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />
      <Sidebar onNavigate={() => setSidebarOpen(false)} />

      <main className="main">
        <header className="topbar">
          <button
            className="icon-btn menu-btn"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle sidebar"
          >
            <IconMenu width={20} height={20} />
          </button>
          <div className="topbar-title" title={active?.title}>
            {active?.title || 'New chat'}
          </div>
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
