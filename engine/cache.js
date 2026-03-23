import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, "..", "cache");

function resolvePath(key) {
  return join(CACHE_DIR, key.endsWith(".json") ? key : `${key}.json`);
}

export function get(key) {
  const path = resolvePath(key);
  if (!existsSync(path)) return null;

  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    if (raw._ttl && Date.now() - raw._cachedAt > raw._ttl) return null;
    return raw.data;
  } catch {
    return null;
  }
}

export function set(key, data, ttlMs = 0) {
  const path = resolvePath(key);
  mkdirSync(dirname(path), { recursive: true });
  const envelope = { data, _cachedAt: Date.now(), _ttl: ttlMs };
  writeFileSync(path, JSON.stringify(envelope, null, 2));
}

export function getAge(key) {
  const path = resolvePath(key);
  if (!existsSync(path)) return Infinity;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    return Date.now() - raw._cachedAt;
  } catch {
    return Infinity;
  }
}

export function invalidate(key) {
  const path = resolvePath(key);
  if (existsSync(path)) unlinkSync(path);
}

export function getRaw(key) {
  const path = resolvePath(key);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

// TTL constants
export const TTL = {
  LEADERBOARD: 60 * 60 * 1000,        // 1 hour
  AGENT_JOBS: 4 * 60 * 60 * 1000,     // 4 hours
  CLIENT_WALLETS: 0,                    // forever (immutable)
  WALLET_TRACES: 0,                     // forever (funding sources are immutable)
};
