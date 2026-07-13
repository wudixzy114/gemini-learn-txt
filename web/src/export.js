// Export a conversation transcript as a Markdown file, downloaded client-side.
// Only the visible exchange is included (user questions + assistant answers);
// the model's reasoning/"thought process" is intentionally left out.

function fileStamp(ts) {
  const d = ts ? new Date(ts) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

// Keep the download name filesystem-safe and reasonably short.
function safeName(title) {
  const base = (title || 'conversation')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'conversation';
  return base;
}

export function conversationToMarkdown(conv, messages) {
  const lines = [];
  lines.push(`# ${conv.title || 'Conversation'}`);
  lines.push('');
  const meta = [];
  if (conv.model) meta.push(`**Model:** ${conv.model}`);
  meta.push(`**Messages:** ${messages.length}`);
  meta.push(`**Exported:** ${new Date().toLocaleString()}`);
  lines.push(meta.join('  \n'));
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const m of messages) {
    const who = m.role === 'user' ? 'You' : 'Study Room';
    lines.push(`## ${who}`);
    lines.push('');
    lines.push((m.content || '').trim());
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

export function downloadConversationMarkdown(conv, messages) {
  if (!conv || !messages?.length) return;
  const md = conversationToMarkdown(conv, messages);
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName(conv.title)}-${fileStamp(conv.updatedAt)}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
