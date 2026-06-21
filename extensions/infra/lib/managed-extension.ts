import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isManagedExtensionEnabled } from "./bundle-config.js";
import { getExtensionConfig, type ExtensionConfigDefinition } from "./extension-config.js";

export type ManagedExtensionOptions = {
  name: string;
  featureFlag?: string;
  setup: (pi: ExtensionAPI) => unknown;
};

export type ManagedConfiguredExtensionOptions<TRaw extends Record<string, unknown>, TConfig> = {
  name: string;
  featureFlag?: string;
  config: ExtensionConfigDefinition<TRaw, TConfig>;
  setup: (pi: ExtensionAPI, getConfig: () => TConfig) => unknown;
};

function hasConfig<TRaw extends Record<string, unknown>, TConfig>(
  options: ManagedExtensionOptions | ManagedConfiguredExtensionOptions<TRaw, TConfig>,
): options is ManagedConfiguredExtensionOptions<TRaw, TConfig> {
  return "config" in options;
}

export function defineManagedExtension(
  options: ManagedExtensionOptions,
): (pi: ExtensionAPI) => unknown;
export function defineManagedExtension<TRaw extends Record<string, unknown>, TConfig>(
  options: ManagedConfiguredExtensionOptions<TRaw, TConfig>,
): (pi: ExtensionAPI) => unknown;
export function defineManagedExtension<TRaw extends Record<string, unknown>, TConfig>(
  options: ManagedExtensionOptions | ManagedConfiguredExtensionOptions<TRaw, TConfig>,
) {
  // Config-backed extensions receive a live getter instead of a startup snapshot.
  // Global and CLI-override config exists during extension load, but trusted
  // project-local config only merges on session_start after trust resolves.
  // Handlers that must honor local config should call getConfig() at runtime.
  return function managedExtension(pi: ExtensionAPI) {
    if (!isManagedExtensionEnabled(options.name, options.featureFlag)) return;

    if (!hasConfig(options)) {
      return options.setup(pi);
    }

    const getConfig = () => getExtensionConfig(options.name, options.config);
    return options.setup(pi, getConfig);
  };
}
