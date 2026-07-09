import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// A tiny, dependency-free JSON store. Conversations persist to disk so the
// full history survives server restarts; each conversation is one file.
const convDir = path.join(config.dataDir, 'conversations');

function ensureDirs() {
  fs.mkdirSync(convDir, { recursive: true });
}
ensureDirs();

function convPath(id) {
  return path.join(convDir, `${id}.json`);
}

function isSafeId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

export function listConversations() {
  const files = fs.readdirSync(convDir).filter((f) => f.endsWith('.json'));
  const items = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(convDir, file), 'utf8');
      const conv = JSON.parse(raw);
      items.push({
        id: conv.id,
        title: conv.title || 'New chat',
        model: conv.model,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        messageCount: Array.isArray(conv.messages) ? conv.messages.length : 0,
      });
    } catch {
      // Skip corrupt files rather than crash the listing.
    }
  }
  items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return items;
}

export function getConversation(id) {
  if (!isSafeId(id)) return null;
  try {
    const raw = fs.readFileSync(convPath(id), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveConversation(conv) {
  if (!isSafeId(conv.id)) throw new Error('Invalid conversation id');
  fs.writeFileSync(convPath(conv.id), JSON.stringify(conv, null, 2), 'utf8');
  return conv;
}

export function deleteConversation(id) {
  if (!isSafeId(id)) return false;
  try {
    fs.unlinkSync(convPath(id));
    return true;
  } catch {
    return false;
  }
}
