import { create } from 'zustand';
import { api, sendMessage } from './api.js';

export const useStore = create((set, get) => ({
  conversations: [],
  activeId: null,
  messages: [],
  loadingList: true,
  loadingConversation: false,
  streaming: false,
  streamError: null,
  controller: null,

  // ---- Bootstrapping -------------------------------------------------------
  async init() {
    try {
      const conversations = await api.listConversations();
      set({ conversations, loadingList: false });
      if (conversations.length > 0) {
        await get().selectConversation(conversations[0].id);
      } else {
        await get().newChat();
      }
    } catch (err) {
      set({ loadingList: false, streamError: err.message });
    }
  },

  // ---- Conversation lifecycle ---------------------------------------------
  async newChat() {
    // Reuse an existing empty "New chat" instead of piling up blanks.
    const existingEmpty = get().conversations.find(
      (c) => c.title === 'New chat' && c.messageCount === 0
    );
    if (existingEmpty) {
      return get().selectConversation(existingEmpty.id);
    }
    const conv = await api.createConversation();
    set((s) => ({
      conversations: [{ ...conv, messageCount: 0 }, ...s.conversations],
      activeId: conv.id,
      messages: [],
      streamError: null,
    }));
  },

  async selectConversation(id) {
    if (get().streaming) get().stopGeneration();
    if (id === get().activeId) return;
    set({ loadingConversation: true, streamError: null, activeId: id });
    try {
      const conv = await api.getConversation(id);
      set({ messages: conv.messages, loadingConversation: false });
    } catch (err) {
      set({ loadingConversation: false, streamError: err.message });
    }
  },

  async deleteConversation(id) {
    await api.deleteConversation(id);
    const remaining = get().conversations.filter((c) => c.id !== id);
    set({ conversations: remaining });
    if (get().activeId === id) {
      if (remaining.length > 0) await get().selectConversation(remaining[0].id);
      else await get().newChat();
    }
  },

  async renameConversation(id, title) {
    const clean = title.trim();
    if (!clean) return;
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, title: clean } : c
      ),
    }));
    try {
      await api.renameConversation(id, clean);
    } catch { /* keep optimistic value */ }
  },

  // ---- Sending & streaming -------------------------------------------------
  async send(content) {
    const text = content.trim();
    const id = get().activeId;
    if (!text || !id || get().streaming) return;

    const userMsg = { id: `local-${Date.now()}`, role: 'user', content: text };
    const assistantMsg = { id: `local-a-${Date.now()}`, role: 'assistant', content: '' };

    set((s) => ({
      messages: [...s.messages, userMsg, assistantMsg],
      streaming: true,
      streamError: null,
    }));

    const bump = () =>
      set((s) => ({
        conversations: [...s.conversations].sort((a, b) =>
          a.id === id ? -1 : b.id === id ? 1 : 0
        ),
      }));

    const controller = sendMessage(id, text, {
      onUser: (serverMsg) => {
        set((s) => ({
          messages: s.messages.map((m) => (m.id === userMsg.id ? serverMsg : m)),
        }));
      },
      onDelta: (delta) => {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: m.content + delta } : m
          ),
        }));
      },
      onDone: ({ message, title }) => {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === assistantMsg.id ? message : m
          ),
          streaming: false,
          controller: null,
          conversations: s.conversations.map((c) =>
            c.id === id
              ? {
                  ...c,
                  title: title || c.title,
                  messageCount: (c.messageCount || 0) + 2,
                  updatedAt: Date.now(),
                }
              : c
          ),
        }));
        bump();
      },
      onError: (message) => {
        set((s) => ({
          streaming: false,
          controller: null,
          streamError: message,
          // Drop the empty assistant bubble if nothing streamed.
          messages: s.messages.filter(
            (m) => !(m.id === assistantMsg.id && !m.content)
          ),
        }));
      },
    });

    set({ controller });
  },

  stopGeneration() {
    const { controller } = get();
    controller?.abort();
    set({ streaming: false, controller: null });
  },
}));
