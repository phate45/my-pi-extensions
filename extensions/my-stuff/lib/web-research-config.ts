import { defineExtensionConfig } from "../../infra/lib/extension-config.js";

export type WebResearchDepth = "fast" | "deep";
export type WebResearchFreshness = "cached" | "live";

export type WebResearchConfig = {
  defaultDepth: WebResearchDepth;
  defaultFreshness: WebResearchFreshness;
};

export const DEFAULT_WEB_RESEARCH_CONFIG: WebResearchConfig = {
  defaultDepth: "fast",
  defaultFreshness: "cached",
};

export function normalizeWebResearchConfig(
  raw: Record<string, unknown> | undefined,
  defaults: WebResearchConfig = DEFAULT_WEB_RESEARCH_CONFIG,
): WebResearchConfig {
  return {
    defaultDepth: raw?.defaultDepth === "deep" ? "deep" : defaults.defaultDepth,
    defaultFreshness: raw?.defaultFreshness === "live" ? "live" : defaults.defaultFreshness,
  };
}

export const webResearchConfig = defineExtensionConfig({
  defaults: DEFAULT_WEB_RESEARCH_CONFIG,
  normalize: normalizeWebResearchConfig,
});
