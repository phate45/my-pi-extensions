import { defineExtensionConfig } from "../../infra/lib/extension-config.js";

export type ClaudeMarkdownExpansionConfig = {
  disableBash: boolean;
  disableIncludes: boolean;
};

export const DEFAULT_CLAUDE_MARKDOWN_EXPANSION_CONFIG: ClaudeMarkdownExpansionConfig = {
  disableBash: false,
  disableIncludes: false,
};

export function normalizeClaudeMarkdownExpansionConfig(
  raw: Record<string, unknown> | undefined,
  defaults: ClaudeMarkdownExpansionConfig = DEFAULT_CLAUDE_MARKDOWN_EXPANSION_CONFIG,
): ClaudeMarkdownExpansionConfig {
  return {
    disableBash: raw?.disableBash === true ? true : defaults.disableBash,
    disableIncludes: raw?.disableIncludes === true ? true : defaults.disableIncludes,
  };
}

export const claudeMarkdownExpansionConfig = defineExtensionConfig({
  defaults: DEFAULT_CLAUDE_MARKDOWN_EXPANSION_CONFIG,
  normalize: normalizeClaudeMarkdownExpansionConfig,
});
