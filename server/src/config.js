import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');

// The gateway credentials live in the project-root .env (shared with other tooling).
dotenv.config({ path: path.join(rootDir, '.env') });

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`\n[config] Missing required env var: ${name}`);
    console.error(`[config] Add it to ${path.join(rootDir, '.env')} and restart.\n`);
    process.exit(1);
  }
  return value;
}

// Selectable models. Only the Gemini family speaks the gateway's native
// /v1/responses protocol that this server implements (Claude/DeepSeek/GLM 404
// there), so the switcher is scoped to Gemini. Each entry is a chat option the
// UI offers; `id` is the exact gateway model id sent upstream.
export const MODELS = [
  {
    id: 'Gemini-3-Flash-Preview-joybuilder',
    label: 'Gemini 3 Flash',
    blurb: 'Fast, everyday answers',
  },
  {
    id: 'Gemini-3.1-Pro-Preview-joybuilder',
    label: 'Gemini 3.1 Pro',
    blurb: 'Deeper reasoning, slower',
  },
];

export function isValidModel(id) {
  return MODELS.some((m) => m.id === id);
}

const DEFAULT_MODEL = 'Gemini-3-Flash-Preview-joybuilder';

export const config = {
  rootDir,
  port: Number(process.env.PORT) || 8791,
  apiKey: required('JD_LLM_API_KEY'),
  baseUrl: required('JD_LLM_BASE_URL').replace(/\/+$/, ''),
  // Default model for new conversations. Per-conversation choice overrides this.
  model: isValidModel(process.env.XIAOSHU_MODEL) ? process.env.XIAOSHU_MODEL : DEFAULT_MODEL,
  // Gemini-3 reasoning depth for the main chat: "high" (max) | "medium" | "low".
  // (Gemini 3 uses thinkingLevel; the older numeric thinkingBudget is superseded.)
  thinkingLevel: process.env.XIAOSHU_THINKING_LEVEL || 'high',
  // Max answer tokens for the main chat. 65536 is the gateway's hard ceiling for
  // this model (it rejects >=65537 with INVALID_ARGUMENT). Input isn't a request
  // param — it's the model's ~1M context window, and full history is always sent.
  maxOutputTokens: Number(process.env.XIAOSHU_MAX_OUTPUT_TOKENS) || 65536,
  timeoutMs: (Number(process.env.JD_LLM_TIMEOUT) || 90) * 1000,
  maxRetries: Number(process.env.JD_LLM_MAX_RETRIES) || 2,
  dataDir: process.env.XIAOSHU_DATA_DIR
    ? path.resolve(process.env.XIAOSHU_DATA_DIR)
    : path.join(rootDir, 'server', 'data'),
};
