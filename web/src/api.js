// Thin API client. All calls are same-origin relative URLs; Vite proxies /api
// to the backend in dev, and the backend serves the built app in production.

async function json(res) {
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).error;
    } catch { /* ignore */ }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  health: () => fetch('/api/health').then(json),

  listModels: () => fetch('/api/models').then(json),

  listConversations: () => fetch('/api/conversations').then(json),

  createConversation: () =>
    fetch('/api/conversations', { method: 'POST' }).then(json),

  getConversation: (id) => fetch(`/api/conversations/${id}`).then(json),

  renameConversation: (id, title) =>
    fetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }).then(json),

  setModel: (id, model) =>
    fetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    }).then(json),

  deleteConversation: (id) =>
    fetch(`/api/conversations/${id}`, { method: 'DELETE' }).then(json),
};

/**
 * Send a message and consume the SSE stream.
 * Callbacks: onUser, onDelta(text), onReasoning(text), onDone({message,title}), onError(msg).
 * Returns an AbortController so the caller can stop generation.
 */
export function sendMessage(conversationId, content, handlers = {}, model) {
  const controller = new AbortController();

  (async () => {
    let res;
    try {
      res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(model ? { content, model } : { content }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name !== 'AbortError') handlers.onError?.(err.message);
      return;
    }

    if (!res.ok || !res.body) {
      let msg = `Request failed (${res.status})`;
      try {
        msg = (await res.json()).error || msg;
      } catch { /* ignore */ }
      handlers.onError?.(msg);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const dispatch = (event, data) => {
      if (event === 'user') handlers.onUser?.(data);
      else if (event === 'delta') handlers.onDelta?.(data.text);
      else if (event === 'reasoning') handlers.onReasoning?.(data.text);
      else if (event === 'done') handlers.onDone?.(data);
      else if (event === 'error') handlers.onError?.(data.message);
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sep;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          let event = 'message';
          let dataLine = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLine += line.slice(5).trim();
          }
          if (!dataLine) continue;
          try {
            dispatch(event, JSON.parse(dataLine));
          } catch { /* ignore malformed frame */ }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') handlers.onError?.(err.message);
    }
  })();

  return controller;
}
