import { defineExtensionConfig } from "../../infra/lib/extension-config.js";

export type PlainAbbreviation = {
  kind: "plain";
  space?: string;
  enter?: string;
};

export type BangAbbreviation = {
  kind: "bang";
  append: string;
};

export type AbbreviationEntry = PlainAbbreviation | BangAbbreviation;

export type AbbreviationsConfig = {
  entries: Record<string, AbbreviationEntry>;
};

export const DEFAULT_ABBREVIATIONS_CONFIG: AbbreviationsConfig = {
  entries: {},
};

function normalizeText(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeEntry(key: string, value: unknown): AbbreviationEntry | undefined {
  if (key.startsWith("!")) {
    if (typeof value === "string") {
      return { kind: "bang", append: value };
    }

    if (!isRecord(value)) return undefined;
    const append = normalizeText(value.append);
    if (!append) return undefined;
    if (value.space !== undefined || value.enter !== undefined) return undefined;
    return { kind: "bang", append };
  }

  if (typeof value === "string") {
    return { kind: "plain", space: value, enter: value };
  }

  if (!isRecord(value)) return undefined;

  if (value.append !== undefined) return undefined;

  const space = normalizeText(value.space);
  const enter = normalizeText(value.enter);
  if (!space && !enter) return undefined;

  return {
    kind: "plain",
    ...(space ? { space } : {}),
    ...(enter ? { enter } : {}),
  };
}

export function normalizeAbbreviationsConfig(
  raw: Record<string, unknown> | undefined,
): AbbreviationsConfig {
  if (!isRecord(raw?.entries)) return DEFAULT_ABBREVIATIONS_CONFIG;

  const entries: Record<string, AbbreviationEntry> = {};
  for (const [key, value] of Object.entries(raw.entries)) {
    const normalized = normalizeEntry(key, value);
    if (normalized) {
      entries[key] = normalized;
    }
  }

  return { entries };
}

export const abbreviationsConfig = defineExtensionConfig({
  defaults: DEFAULT_ABBREVIATIONS_CONFIG,
  normalize: normalizeAbbreviationsConfig,
});
