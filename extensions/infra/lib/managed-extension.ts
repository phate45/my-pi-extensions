import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isManagedExtensionEnabled } from "./bundle-config.js";

export type ManagedExtensionOptions = {
  name: string;
  featureFlag?: string;
  setup: (pi: ExtensionAPI) => unknown;
};

export type ManagedConfiguredExtensionOptions<TConfig> = {
  name: string;
  featureFlag?: string;
  getConfig: () => TConfig;
  setup: (pi: ExtensionAPI, getConfig: () => TConfig) => unknown;
};

function hasConfig<TConfig>(
  options: ManagedExtensionOptions | ManagedConfiguredExtensionOptions<TConfig>,
): options is ManagedConfiguredExtensionOptions<TConfig> {
  return "getConfig" in options;
}

export function defineManagedExtension(
  options: ManagedExtensionOptions,
): (pi: ExtensionAPI) => unknown;
export function defineManagedExtension<TConfig>(
  options: ManagedConfiguredExtensionOptions<TConfig>,
): (pi: ExtensionAPI) => unknown;
export function defineManagedExtension<TConfig>(
  options: ManagedExtensionOptions | ManagedConfiguredExtensionOptions<TConfig>,
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

    return options.setup(pi, options.getConfig);
  };
}
