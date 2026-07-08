import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import { config } from './config.js';
import {
  listConversations,
  getConversation,
  saveConversation,
  deleteConversation,
} from './store.js';
import { streamChat, completeOnce } from './llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: '4mb' }));

const now = () => Date.now();

function newConversation() {
  const ts = now();
  return { id: nanoid(12), title: 'New chat', createdAt: ts, updatedAt: ts, messages: [] };
}

// ---- Health / meta ---------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, model: config.model });
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

app.get('/api/conversations/:id', (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  res.json(conv);
});

app.patch('/api/conversations/:id', (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  if (typeof req.body.title === 'string') {
    conv.title = req.body.title.slice(0, 120).trim() || conv.title;
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
// POST /api/conversations/:id/messages  { content }
// Streams the assistant reply as SSE, then persists both messages.
app.post('/api/conversations/:id/messages', async (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  if (!content) return res.status(400).json({ error: 'Message content is required' });

  const userMsg = { id: nanoid(10), role: 'user', content, createdAt: now() };
  conv.messages.push(userMsg);
  conv.updatedAt = now();
  saveConversation(conv);

  // Open the SSE stream.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send('user', userMsg);

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

  // Auto-title on the first exchange, best-effort and non-blocking for the stream.
  let titled = false;
  if (conv.title === 'New chat') {
    try {
      const title = await completeOnce({
        systemPrompt:
          'Generate a short, specific title (2-6 words, no quotes, no trailing punctuation) ' +
          'for a conversation that starts with the user message below. Reply with the title only, ' +
          'in the same language as the message.',
        messages: [{ role: 'user', content }],
      });
      if (title) {
        conv.title = title.replace(/^["'“”]+|["'“”]+$/g, '').slice(0, 80);
        titled = true;
      }
    } catch {
      // Titling is optional; ignore failures.
    }
  }

  saveConversation(conv);
  finished = true;
  send('done', { message: assistantMsg, title: titled ? conv.title : undefined });
  res.end();
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
