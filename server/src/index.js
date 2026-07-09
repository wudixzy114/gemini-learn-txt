import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import { config, MODELS, isValidModel } from './config.js';
import {
  listConversations,
  getConversation,
  saveConversation,
  deleteConversation,
  reorderConversations,
  nextTopOrder,
} from './store.js';
import { streamChat, completeOnce } from './llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: '4mb' }));

const now = () => Date.now();

function newConversation() {
  const ts = now();
  return { id: nanoid(12), title: 'New chat', model: config.model, order: nextTopOrder(), createdAt: ts, updatedAt: ts, messages: [] };
}

// ---- Health / meta ---------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, model: config.model });
});

// Model catalog the UI offers, plus which one is the default.
app.get('/api/models', (_req, res) => {
  res.json({ models: MODELS, default: config.model });
});

// ---- Conversation CRUD -----------------------------------------------------
app.get('/api/conversations', (_req, res) => {
  res.json(listConversations());
});

app.post('/api/conversations', (_req, res) => {
  const conv = newConversation();
  saveConversation(conv);
  res.status(201).json(conv);
});

// Persist a manual list order. Body: { ids: [id, ...] } in top-to-bottom order.
app.put('/api/conversations/order', (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
  reorderConversations(ids);
  res.json({ ok: true });
});

app.get('/api/conversations/:id', (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  res.json(conv);
});

app.patch('/api/conversations/:id', (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  let changed = false;
  if (typeof req.body.title === 'string') {
    conv.title = req.body.title.slice(0, 120).trim() || conv.title;
    changed = true;
  }
  if (typeof req.body.model === 'string') {
    if (!isValidModel(req.body.model)) {
      return res.status(400).json({ error: 'Unknown model' });
    }
    conv.model = req.body.model;
    changed = true;
  }
  if (changed) {
    conv.updatedAt = now();
    saveConversation(conv);
  }
  res.json(conv);
});

app.delete('/api/conversations/:id', (req, res) => {
  const ok = deleteConversation(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Conversation not found' });
  res.status(204).end();
});

// ---- Streaming chat --------------------------------------------------------

// Resolve the model for a turn: an explicit (valid) request override wins, else
// the conversation's saved choice, else the server default.
function resolveModel(requested, conv) {
  return (
    (typeof requested === 'string' && isValidModel(requested) && requested) ||
    (isValidModel(conv.model) && conv.model) ||
    config.model
  );
}

function openSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  return (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

// Stream one assistant reply for `conv` (whose messages array already ends at
// the user turn to answer), emitting SSE frames via `send` and persisting the
// result. `onDone(assistantMsg)` runs after a successful stream and before the
// conversation is saved; whatever object it returns is merged into the 'done'
// frame (used for auto-titling). Shared by the new-message and regenerate routes.
async function streamAssistantReply({ res, conv, model, send, onDone }) {
  const assistantMsg = { id: nanoid(10), role: 'assistant', content: '', reasoning: '', createdAt: now() };
  const abort = new AbortController();
  // Abort the upstream call only if the client disconnects mid-stream.
  // Listen on `res`, not `req`: `req` emits 'close' as soon as its body is
  // consumed, which would abort every request immediately.
  let finished = false;
  res.on('close', () => {
    if (!finished) abort.abort();
  });

  try {
    await streamChat({
      messages: conv.messages,
      signal: abort.signal,
      model,
      onReasoning: (delta) => {
        assistantMsg.reasoning += delta;
        send('reasoning', { text: delta });
      },
      onDelta: (delta) => {
        assistantMsg.content += delta;
        send('delta', { text: delta });
      },
    });
  } catch (err) {
    finished = true;
    // Persist whatever partial text we streamed so it isn't lost.
    if (assistantMsg.content || assistantMsg.reasoning) {
      conv.messages.push(assistantMsg);
      conv.updatedAt = now();
      saveConversation(conv);
    }
    send('error', { message: err.message || 'Generation failed' });
    return res.end();
  }

  conv.messages.push(assistantMsg);
  conv.updatedAt = now();
  const extra = onDone ? (await onDone(assistantMsg)) || {} : {};
  saveConversation(conv);
  finished = true;
  send('done', { message: assistantMsg, ...extra });
  res.end();
}

// POST /api/conversations/:id/messages  { content }
// Streams the assistant reply as SSE, then persists both messages.
app.post('/api/conversations/:id/messages', async (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  if (!content) return res.status(400).json({ error: 'Message content is required' });

  // Persist the resolved model so the conversation remembers the last one used.
  const model = resolveModel(req.body.model, conv);
  conv.model = model;

  const userMsg = { id: nanoid(10), role: 'user', content, createdAt: now() };
  conv.messages.push(userMsg);
  conv.updatedAt = now();
  saveConversation(conv);

  const send = openSSE(res);
  send('user', userMsg);

  await streamAssistantReply({
    res, conv, model, send,
    // Auto-title on the first exchange, best-effort.
    onDone: async () => {
      if (conv.title !== 'New chat') return {};
      try {
        const title = await completeOnce({
          model,
          systemPrompt:
            'Generate a short, specific title (2-6 words, no quotes, no trailing punctuation) ' +
            'for a conversation that starts with the user message below. Reply with the title only, ' +
            'in the same language as the message.',
          messages: [{ role: 'user', content }],
        });
        if (title) {
          conv.title = title.replace(/^["'“”]+|["'“”]+$/g, '').slice(0, 80);
          return { title: conv.title };
        }
      } catch {
        // Titling is optional; ignore failures.
      }
      return {};
    },
  });
});

// POST /api/conversations/:id/messages/:messageId/regenerate
// Regenerate the latest assistant reply (retry is offered only on the newest
// answer). Drops that reply and re-streams a fresh one from the same history.
app.post('/api/conversations/:id/messages/:messageId/regenerate', async (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const msgs = conv.messages;
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== 'assistant' || last.id !== req.params.messageId) {
    return res.status(409).json({ error: 'Can only regenerate the latest assistant reply' });
  }
  if (msgs.length < 2 || msgs[msgs.length - 2].role !== 'user') {
    return res.status(409).json({ error: 'Nothing to regenerate from' });
  }

  // Drop the old reply in memory only — don't persist the removal yet, so the
  // previous answer survives on disk if generation fails before any text streams.
  msgs.pop();
  const model = resolveModel(req.body.model, conv);
  conv.model = model;

  const send = openSSE(res);
  await streamAssistantReply({ res, conv, model, send });
});

// DELETE /api/conversations/:id/messages/:messageId
// Deletes the whole turn the message belongs to (a user message plus the
// assistant reply that follows it, or an assistant reply plus its question) so
// the transcript stays coherent. Returns the surviving messages.
app.delete('/api/conversations/:id/messages/:messageId', (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const idx = conv.messages.findIndex((m) => m.id === req.params.messageId);
  if (idx === -1) return res.status(404).json({ error: 'Message not found' });

  const msg = conv.messages[idx];
  let start = idx;
  let end = idx;
  if (msg.role === 'user' && conv.messages[idx + 1]?.role === 'assistant') {
    end = idx + 1;
  } else if (msg.role === 'assistant' && conv.messages[idx - 1]?.role === 'user') {
    start = idx - 1;
  }
  conv.messages.splice(start, end - start + 1);
  conv.updatedAt = now();
  saveConversation(conv);
  res.json({ messages: conv.messages });
});

// ---- Serve built frontend in production ------------------------------------
const webDist = path.resolve(__dirname, '..', '..', 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

app.listen(config.port, () => {
  console.log(`\n  ▸ gemini-text-learn server`);
  console.log(`    model:   ${config.model}`);
  console.log(`    gateway: ${config.baseUrl}`);
  console.log(`    listening on http://localhost:${config.port}\n`);
});
