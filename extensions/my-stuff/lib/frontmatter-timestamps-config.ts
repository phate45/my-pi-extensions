import { defineExtensionConfig } from "../../infra/lib/extension-config.js";

export type FrontmatterTimestampsConfig = {
  includePaths: string[];
  includeExtensions: string[];
  includeTimezone: boolean;
};

export const DEFAULT_FRONTMATTER_TIMESTAMPS_CONFIG: FrontmatterTimestampsConfig = {
  includePaths: [],
  includeExtensions: [".md", ".mdx", ".markdown"],
  includeTimezone: false,
};

function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) return [];

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  return [...new Set(normalized)];
}

function normalizeExtensions(value: unknown) {
  return normalizeStringList(value).map((extension) =>
    extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`,
  );
}

export function normalizeFrontmatterTimestampsConfig(
  raw: Record<string, unknown> | undefined,
  defaults: FrontmatterTimestampsConfig = DEFAULT_FRONTMATTER_TIMESTAMPS_CONFIG,
): FrontmatterTimestampsConfig {
  const includePaths = normalizeStringList(raw?.includePaths);
  const includeExtensions = normalizeExtensions(raw?.includeExtensions);

  return {
    includePaths,
    includeExtensions:
      includeExtensions.length > 0 ? includeExtensions : defaults.includeExtensions,
    includeTimezone: raw?.includeTimezone === true,
  };
}

export const frontmatterTimestampsConfig = defineExtensionConfig({
  defaults: DEFAULT_FRONTMATTER_TIMESTAMPS_CONFIG,
  normalize: normalizeFrontmatterTimestampsConfig,
});
