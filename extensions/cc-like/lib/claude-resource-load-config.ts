import { defineExtensionConfig, getExtensionConfig } from "../../infra/lib/extension-config.js";

export type ClaudeFileSourceConfig = {
  global: boolean;
  project: boolean;
  local: boolean;
};

export type ClaudeResourceSourceConfig = {
  global: boolean;
  project: boolean;
};

export type ClaudeCommandSourceConfig = ClaudeResourceSourceConfig & {
  loadInHeadless: boolean;
};

export type CcContextLocalFilesConfig = {
  claudeFiles: ClaudeFileSourceConfig;
};

export type CcResourcePathsConfig = {
  commands: ClaudeCommandSourceConfig;
  skills: ClaudeResourceSourceConfig;
};

export const DEFAULT_CLAUDE_FILE_SOURCE_CONFIG: ClaudeFileSourceConfig = {
  global: true,
  project: true,
  local: true,
};

export const DEFAULT_CLAUDE_RESOURCE_SOURCE_CONFIG: ClaudeResourceSourceConfig = {
  global: true,
  project: true,
};

export const DEFAULT_CLAUDE_COMMAND_SOURCE_CONFIG: ClaudeCommandSourceConfig = {
  ...DEFAULT_CLAUDE_RESOURCE_SOURCE_CONFIG,
  loadInHeadless: false,
};

export const DEFAULT_CC_CONTEXT_LOCAL_FILES_CONFIG: CcContextLocalFilesConfig = {
  claudeFiles: DEFAULT_CLAUDE_FILE_SOURCE_CONFIG,
};

export const DEFAULT_CC_RESOURCE_PATHS_CONFIG: CcResourcePathsConfig = {
  commands: DEFAULT_CLAUDE_COMMAND_SOURCE_CONFIG,
  skills: DEFAULT_CLAUDE_RESOURCE_SOURCE_CONFIG,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeClaudeFileSourceConfig(
  raw: unknown,
  defaults: ClaudeFileSourceConfig,
): ClaudeFileSourceConfig {
  const source = isRecord(raw) ? raw : {};
  return {
    global: normalizeBoolean(source.global, defaults.global),
    project: normalizeBoolean(source.project, defaults.project),
    local: normalizeBoolean(source.local, defaults.local),
  };
}

function normalizeClaudeResourceSourceConfig(
  raw: unknown,
  defaults: ClaudeResourceSourceConfig,
): ClaudeResourceSourceConfig {
  const source = isRecord(raw) ? raw : {};
  return {
    global: normalizeBoolean(source.global, defaults.global),
    project: normalizeBoolean(source.project, defaults.project),
  };
}

function normalizeClaudeCommandSourceConfig(
  raw: unknown,
  defaults: ClaudeCommandSourceConfig,
): ClaudeCommandSourceConfig {
  const source = isRecord(raw) ? raw : {};
  return {
    ...normalizeClaudeResourceSourceConfig(source, defaults),
    loadInHeadless: normalizeBoolean(source.loadInHeadless, defaults.loadInHeadless),
  };
}

export function normalizeCcContextLocalFilesConfig(
  raw: Record<string, unknown> | undefined,
  defaults: CcContextLocalFilesConfig = DEFAULT_CC_CONTEXT_LOCAL_FILES_CONFIG,
): CcContextLocalFilesConfig {
  return {
    claudeFiles: normalizeClaudeFileSourceConfig(raw?.claudeFiles, defaults.claudeFiles),
  };
}

export function normalizeCcResourcePathsConfig(
  raw: Record<string, unknown> | undefined,
  defaults: CcResourcePathsConfig = DEFAULT_CC_RESOURCE_PATHS_CONFIG,
): CcResourcePathsConfig {
  return {
    commands: normalizeClaudeCommandSourceConfig(raw?.commands, defaults.commands),
    skills: normalizeClaudeResourceSourceConfig(raw?.skills, defaults.skills),
  };
}

export const ccContextLocalFilesConfig = defineExtensionConfig({
  defaults: DEFAULT_CC_CONTEXT_LOCAL_FILES_CONFIG,
  normalize: normalizeCcContextLocalFilesConfig,
});

export const ccResourcePathsConfig = defineExtensionConfig({
  defaults: DEFAULT_CC_RESOURCE_PATHS_CONFIG,
  normalize: normalizeCcResourcePathsConfig,
});

export function getCcContextLocalFilesConfig(): CcContextLocalFilesConfig {
  return getExtensionConfig("cc-context-local-files", ccContextLocalFilesConfig);
}

export function getCcResourcePathsConfig(): CcResourcePathsConfig {
  return getExtensionConfig("cc-resource-paths", ccResourcePathsConfig);
}
