/**
 * Key material for the TensorX pool, read from ~/.pi/agent/tensorx-keys.json.
 *
 * TensorX meters each key independently, so a pool of distinct keys multiplies the
 * rate limit. Duplicates are dropped: two entries holding the same key would report
 * as two lanes while sharing one quota.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { PoolKey } from "./key-pool.js";

const KEYS_FILE = "tensorx-keys.json";
const AUTH_FILE = "auth.json";
const OWNER_ONLY = 0o600;

export type LoadedKeys = {
  keys: PoolKey[];
  path: string;
  /** Startup-visible problems: parse failures, dropped entries, loose permissions. */
  warnings: string[];
};

/** Mirrors pi's own config-directory resolution so both read the same tree. */
function agentDir(baseDir?: string): string {
  return baseDir ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The single key pi already resolves for TensorX, used to seed the pool on first run. */
export function readAuthJsonKey(baseDir?: string): string | undefined {
  const path = join(agentDir(baseDir), AUTH_FILE);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = readJson(path);
    if (!isRecord(parsed)) return undefined;
    const entry = parsed.tensorx;
    if (!isRecord(entry)) return undefined;
    return typeof entry.key === "string" && entry.key.length > 0 ? entry.key : undefined;
  } catch {
    return undefined;
  }
}

function normalizeEntry(raw: unknown, index: number): PoolKey | undefined {
  if (typeof raw === "string") {
    return raw.length > 0 ? { key: raw, label: `key-${index + 1}` } : undefined;
  }
  if (!isRecord(raw)) return undefined;
  const key = raw.key;
  if (typeof key !== "string" || key.length === 0) return undefined;
  const label = typeof raw.label === "string" && raw.label.length > 0 ? raw.label : `key-${index + 1}`;
  return { key, label, ...(raw.enabled === false ? { enabled: false } : {}) };
}

export function normalizeKeys(raw: unknown): { keys: PoolKey[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!isRecord(raw) || !Array.isArray(raw.keys)) {
    return { keys: [], warnings: ['expected an object with a "keys" array'] };
  }

  const keys: PoolKey[] = [];
  const seen = new Set<string>();
  raw.keys.forEach((entry, index) => {
    const normalized = normalizeEntry(entry, index);
    if (!normalized) {
      warnings.push(`ignored key entry ${index + 1}: no usable "key" string`);
      return;
    }
    if (seen.has(normalized.key)) {
      warnings.push(`ignored key entry ${index + 1} ("${normalized.label}"): duplicate of an earlier key`);
      return;
    }
    seen.add(normalized.key);
    keys.push(normalized);
  });

  return { keys, warnings };
}

function writeOwnerOnly(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: OWNER_ONLY });
  chmodSync(path, OWNER_ONLY);
}

/** Create the keys file seeded from auth.json so a first run keeps working unchanged. */
export function seedKeysFile(path: string, seedKey: string | undefined): PoolKey[] {
  const keys: PoolKey[] = seedKey ? [{ key: seedKey, label: "key-1" }] : [];
  writeOwnerOnly(path, {
    keys: keys.map((entry) => ({ key: entry.key, label: entry.label })),
  });
  return keys;
}

export function loadTensorxKeys(baseDir?: string): LoadedKeys {
  const path = join(agentDir(baseDir), KEYS_FILE);

  if (!existsSync(path)) {
    const keys = seedKeysFile(path, readAuthJsonKey(baseDir));
    return { keys, path, warnings: [] };
  }

  let parsed: unknown;
  try {
    parsed = readJson(path);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { keys: [], path, warnings: [`could not parse ${path}: ${detail}`] };
  }

  const { keys, warnings } = normalizeKeys(parsed);

  const mode = statSync(path).mode & 0o777;
  if (mode !== OWNER_ONLY) {
    warnings.push(
      `${path} is mode ${mode.toString(8).padStart(3, "0")}; API keys should be readable only by you (chmod 600)`,
    );
  }

  return { keys, path, warnings };
}
