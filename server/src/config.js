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

export const config = {
  rootDir,
  port: Number(process.env.PORT) || 8791,
  apiKey: required('JD_LLM_API_KEY'),
  baseUrl: required('JD_LLM_BASE_URL').replace(/\/+$/, ''),
  model: process.env.XIAOSHU_MODEL || 'Gemini-3-Flash-Preview-joybuilder',
  // Gemini-3 reasoning depth for the main chat: "high" (max) | "medium" | "low".
  // (Gemini 3 uses thinkingLevel; the older numeric thinkingBudget is superseded.)
  thinkingLevel: process.env.XIAOSHU_THINKING_LEVEL || 'high',
  // Max answer tokens for the main chat. 65536 is the gateway's hard ceiling for
  // this model (it rejects >=65537 with INVALID_ARGUMENT). Input isn't a request
  // param — it's the model's ~1M context window, and full history is always sent.
  maxOutputTokens: Number(process.env.XIAOSHU_MAX_OUTPUT_TOKENS) || 65536,
  timeoutMs: (Number(process.env.JD_LLM_TIMEOUT) || 90) * 1000,
  maxRetries: Number(process.env.JD_LLM_MAX_RETRIES) || 2,
  dataDir: path.join(rootDir, 'server', 'data'),
};
