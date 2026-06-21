import { getExtConfig } from "../../infra/lib/bundle-config.js";

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
): WebResearchConfig {
  return {
    defaultDepth: raw?.defaultDepth === "deep" ? "deep" : DEFAULT_WEB_RESEARCH_CONFIG.defaultDepth,
    defaultFreshness:
      raw?.defaultFreshness === "live" ? "live" : DEFAULT_WEB_RESEARCH_CONFIG.defaultFreshness,
  };
}

export function getWebResearchConfig() {
  return normalizeWebResearchConfig(getExtConfig<Record<string, unknown>>("web-research"));
}
