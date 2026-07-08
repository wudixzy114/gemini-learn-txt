import { config } from './config.js';

// The gateway serves Gemini through Google's native "generateContent" shape at
// /v1/responses: a `contents` array of {role, parts:[{text}]} (role is "user"
// or "model"), an optional `systemInstruction`, and a newline-delimited JSON
// stream (NOT SSE `data:` frames). Each streamed line looks like:
//   {"candidates":[{"content":{"parts":[{"text":"..."}],"role":"model"}}]}
// Some parts carry a `thoughtSignature` with empty text (thinking tokens) —
// those are skipped.

const SYSTEM_PROMPT =
  'You are a knowledgeable, patient study companion. Help the user learn and think clearly. ' +
  'Prefer well-structured Markdown: use headings, short paragraphs, bullet lists, tables when comparing things, ' +
  'and fenced code blocks with a language tag. Use LaTeX ($...$ inline, $$...$$ block) for math. ' +
  'Explain reasoning step by step when it aids understanding, and be concise otherwise. ' +
  'Match the language of your reply to the language the user writes in.';

// Map our stored messages (role: user|assistant) to Gemini contents.
function toContents(messages) {
  return messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
}

function buildBody(messages, { stream, systemPrompt = SYSTEM_PROMPT, generationConfig } = {}) {
  const body = {
    model: config.model,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: toContents(messages),
    stream: Boolean(stream),
  };
  if (generationConfig) body.generationConfig = generationConfig;
  return body;
}

// Pull the text out of a single streamed/parsed Gemini chunk, ignoring
// thinking-only parts (which have empty text alongside a thoughtSignature).
function extractText(json) {
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  let text = '';
  for (const p of parts) {
    if (typeof p?.text === 'string' && p.text) text += p.text;
  }
  return text;
}

async function postResponses(body, abortSignal) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), config.timeoutMs);
  const onClientAbort = () => timeout.abort();
  if (abortSignal) abortSignal.addEventListener('abort', onClientAbort);

  try {
    const response = await fetch(`${config.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: timeout.signal,
    });
    return { response, cleanup: () => {
      clearTimeout(timer);
      if (abortSignal) abortSignal.removeEventListener('abort', onClientAbort);
    } };
  } catch (err) {
    clearTimeout(timer);
    if (abortSignal) abortSignal.removeEventListener('abort', onClientAbort);
    if (err.name === 'AbortError') throw new Error('Request aborted or timed out');
    throw new Error(`Failed to reach LLM gateway: ${err.message}`);
  }
}

/**
 * Stream a chat completion. Calls onDelta(textChunk) for each new text chunk.
 * Returns the full accumulated text. Throws on non-2xx or network failure.
 */
export async function streamChat({ messages, signal, onDelta, temperature = 0.7 }) {
  const body = buildBody(messages, {
    stream: true,
    generationConfig: {
      temperature,
      // Push reasoning to its maximum for the main chat. Gemini 3 controls this
      // with thinkingLevel ("high" = deepest); configurable via XIAOSHU_THINKING_LEVEL.
      thinkingConfig: { thinkingLevel: config.thinkingLevel },
    },
  });

  const { response, cleanup } = await postResponses(body, signal);

  if (!response.ok || !response.body) {
    let detail = '';
    try {
      detail = await response.text();
    } catch { /* ignore */ }
    cleanup();
    throw new Error(`LLM gateway error ${response.status}: ${detail.slice(0, 500)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  const flushLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    // Some gateways prefix newline-delimited JSON with "data:" too; tolerate both.
    const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
    if (!payload || payload === '[DONE]') return;
    try {
      const json = JSON.parse(payload);
      const text = extractText(json);
      if (text) {
        full += text;
        onDelta?.(text);
      }
    } catch {
      // Partial or non-JSON line; ignore (complete lines are handled below).
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Gemini emits newline-delimited JSON objects.
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        flushLine(line);
      }
    }
    // Flush any trailing complete object left without a newline.
    if (buffer.trim()) flushLine(buffer);
  } finally {
    cleanup();
    reader.releaseLock?.();
  }

  return full;
}

/** Non-streaming completion used for short utility calls like auto-titling. */
export async function completeOnce({ messages, systemPrompt, temperature = 0.3, maxTokens = 200 }) {
  const body = buildBody(messages, {
    stream: false,
    systemPrompt: systemPrompt || SYSTEM_PROMPT,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      // Titling is a mechanical task; skip the thinking budget so the token
      // cap goes to the answer rather than being consumed by reasoning.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const { response, cleanup } = await postResponses(body);
  try {
    if (!response.ok) throw new Error(`status ${response.status}`);
    const json = await response.json();
    return extractText(json).trim();
  } finally {
    cleanup();
  }
}
