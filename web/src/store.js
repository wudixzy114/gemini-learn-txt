import { create } from 'zustand';
import { api, sendMessage } from './api.js';

export const useStore = create((set, get) => ({
  conversations: [],
  activeId: null,
  messages: [],
  models: [],
  defaultModel: null,
  activeModel: null,
  loadingList: true,
  loadingConversation: false,
  streaming: false,
  streamError: null,
  controller: null,

  // ---- Bootstrapping -------------------------------------------------------
  async init() {
    // Load the model catalog first so the picker has options; tolerate failure.
    try {
      const { models, default: def } = await api.listModels();
      set({ models, defaultModel: def, activeModel: def });
    } catch { /* picker will just be empty */ }

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
    const { activeId, messages, streaming, conversations } = get();

    // If we're already sitting on an idle, empty "New chat" with nothing typed
    // or streamed, just stay — creating another would pile up blanks. This also
    // fixes the stuck-navigation bug: previously the reuse logic could pick the
    // *active* empty chat, and selectConversation() no-ops on the active id, so
    // the click did nothing and only a refresh recovered.
    const activeConv = conversations.find((c) => c.id === activeId);
    if (
      activeConv &&
      activeConv.title === 'New chat' &&
      (activeConv.messageCount || 0) === 0 &&
      messages.length === 0 &&
      !streaming
    ) {
      set({ streamError: null });
      return;
    }

    // Stop any in-flight stream before leaving the current conversation.
    if (streaming) get().stopGeneration();

    // Reuse a *different* blank "New chat" rather than creating another.
    const existingEmpty = conversations.find(
      (c) => c.id !== activeId && c.title === 'New chat' && (c.messageCount || 0) === 0
    );
    if (existingEmpty) return get().selectConversation(existingEmpty.id);

    const conv = await api.createConversation();
    set((s) => ({
      conversations: [{ ...conv, messageCount: 0 }, ...s.conversations],
      activeId: conv.id,
      messages: [],
      activeModel: conv.model || s.defaultModel,
      streamError: null,
    }));
  },

  async selectConversation(id) {
    // Guard first: selecting the already-active conversation is a true no-op and
    // must NOT abort an in-flight stream (that was part of the stuck-nav bug).
    if (id === get().activeId) return;
    if (get().streaming) get().stopGeneration();
    set({ loadingConversation: true, streamError: null, activeId: id });
    try {
      const conv = await api.getConversation(id);
      set({
        messages: conv.messages,
        activeModel: conv.model || get().defaultModel,
        loadingConversation: false,
      });
    } catch (err) {
      set({ loadingConversation: false, streamError: err.message });
    }
  },

  // Persist a manual list order (drag-to-reorder). Optimistic: apply locally,
  // then save. `orderedIds` is the full list top-to-bottom.
  async reorderConversations(orderedIds) {
    set((s) => {
      const byId = new Map(s.conversations.map((c) => [c.id, c]));
      const next = orderedIds.map((id) => byId.get(id)).filter(Boolean);
      // Keep any not named in the list (safety) appended in their prior order.
      for (const c of s.conversations) if (!orderedIds.includes(c.id)) next.push(c);
      return { conversations: next };
    });
    try {
      await api.reorderConversations(orderedIds);
    } catch { /* keep optimistic order; a reload re-syncs from server */ }
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

  // Switch the active conversation's model. Optimistic: apply locally, then
  // persist. Takes effect on the conversation's next turn. Blocked mid-stream.
  async setModel(model) {
    const id = get().activeId;
    if (!model || !id || get().streaming || model === get().activeModel) return;
    set((s) => ({
      activeModel: model,
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, model } : c
      ),
    }));
    try {
      await api.setModel(id, model);
    } catch { /* keep optimistic value; next send will still send it */ }
  },

  // ---- Sending & streaming -------------------------------------------------
  async send(content) {
    const text = content.trim();
    const id = get().activeId;
    if (!text || !id || get().streaming) return;

    const userMsg = { id: `local-${Date.now()}`, role: 'user', content: text };
    const assistantMsg = { id: `local-a-${Date.now()}`, role: 'assistant', content: '', reasoning: '' };

    set((s) => ({
      messages: [...s.messages, userMsg, assistantMsg],
      streaming: true,
      streamError: null,
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
      onReasoning: (delta) => {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, reasoning: (m.reasoning || '') + delta }
              : m
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
    }, get().activeModel);

    set({ controller });
  },

  stopGeneration() {
    const { controller } = get();
    controller?.abort();
    set({ streaming: false, controller: null });
  },
}));
