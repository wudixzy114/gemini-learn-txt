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

// Read every conversation file, skipping corrupt ones.
function readAll() {
  const files = fs.readdirSync(convDir).filter((f) => f.endsWith('.json'));
  const items = [];
  for (const file of files) {
    try {
      items.push(JSON.parse(fs.readFileSync(path.join(convDir, file), 'utf8')));
    } catch {
      // Skip corrupt files rather than crash.
    }
  }
  return items;
}

// Manual list order is stored as a numeric `order` on each conversation (lower =
// higher in the list). One-time, idempotent migration: any conversation without
// one is assigned a slot by recency, so the first manual order matches the
// most-recent-first list users saw before. Runs at startup; a no-op thereafter.
function ensureOrder() {
  const all = readAll();
  if (all.every((c) => typeof c.order === 'number')) return;
  all.sort((a, b) => {
    const ao = typeof a.order === 'number' ? a.order : Infinity;
    const bo = typeof b.order === 'number' ? b.order : Infinity;
    if (ao !== bo) return ao - bo;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
  all.forEach((conv, i) => {
    if (conv.order !== i) {
      conv.order = i;
      saveConversation(conv);
    }
  });
}
ensureOrder();

// The order value a brand-new conversation should get to sit at the top of the
// list (above every existing one).
export function nextTopOrder() {
  const all = readAll();
  let min = 0;
  for (const c of all) {
    if (typeof c.order === 'number' && c.order < min) min = c.order;
  }
  return min - 1;
}

export function listConversations() {
  const items = readAll().map((conv) => ({
    id: conv.id,
    title: conv.title || 'New chat',
    model: conv.model,
    order: conv.order,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    messageCount: Array.isArray(conv.messages) ? conv.messages.length : 0,
  }));
  // Sort by manual order (asc); fall back to recency for any without one.
  items.sort((a, b) => {
    const ao = typeof a.order === 'number' ? a.order : Infinity;
    const bo = typeof b.order === 'number' ? b.order : Infinity;
    if (ao !== bo) return ao - bo;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
  return items;
}

// Apply a manual order: assign order = position for each id in the given list.
// Ids not present are left untouched. Returns the count actually reordered.
export function reorderConversations(orderedIds) {
  let n = 0;
  orderedIds.forEach((id, i) => {
    if (!isSafeId(id)) return;
    const conv = getConversation(id);
    if (conv && conv.order !== i) {
      conv.order = i;
      saveConversation(conv);
      n += 1;
    }
  });
  return n;
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
