import type { AbbreviationsConfig } from "./abbreviations-config.js";

export type CursorPosition = {
  line: number;
  col: number;
};

function getPlainEntry(config: AbbreviationsConfig, key: string) {
  const entry = config.entries[key];
  return entry?.kind === "plain" ? entry : undefined;
}

function getBangEntry(config: AbbreviationsConfig, key: string) {
  const entry = config.entries[key];
  return entry?.kind === "bang" ? entry : undefined;
}

export function hasConfiguredAbbreviations(config: AbbreviationsConfig) {
  return Object.keys(config.entries).length > 0;
}

export function applyPlainSpaceAbbreviation(
  text: string,
  cursor: CursorPosition,
  config: AbbreviationsConfig,
) {
  const plain = getPlainEntry(config, text);
  if (!plain?.space) return undefined;

  const lines = text.split("\n");
  const lastLine = lines.at(-1) ?? "";
  const atEnd = cursor.line === lines.length - 1 && cursor.col === lastLine.length;
  if (!atEnd) return undefined;

  return plain.space;
}

function collectTrailingBangTokens(text: string, config: AbbreviationsConfig) {
  const trimmed = text.trimEnd();
  if (trimmed.length === 0) return undefined;

  const tokens = trimmed.split(/\s+/);
  const trailing: string[] = [];

  for (let index = tokens.length - 1; index >= 0; index--) {
    const token = tokens[index] ?? "";
    if (!token.startsWith("!")) break;

    const entry = getBangEntry(config, token);
    if (!entry) {
      return undefined;
    }

    trailing.push(token);
  }

  if (trailing.length === 0) return undefined;

  const headCount = tokens.length - trailing.length;
  const head = headCount > 0 ? tokens.slice(0, headCount).join(" ") : "";

  return {
    head,
    bangKeys: trailing.reverse(),
  };
}

export function expandInputAbbreviations(text: string, config: AbbreviationsConfig) {
  const plain = getPlainEntry(config, text);
  if (plain?.enter) {
    return plain.enter;
  }

  const trailing = collectTrailingBangTokens(text, config);
  if (!trailing) return undefined;

  const appended = trailing.bangKeys
    .map((key) => getBangEntry(config, key)?.append)
    .filter(Boolean);
  if (appended.length === 0) return undefined;

  return trailing.head ? `${trailing.head}\n\n${appended.join("\n\n")}` : appended.join("\n\n");
}
