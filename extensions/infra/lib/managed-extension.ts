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
  setup: (pi: ExtensionAPI, config: TConfig) => unknown;
};

export function defineManagedExtension(options: ManagedExtensionOptions): (pi: ExtensionAPI) => unknown;
export function defineManagedExtension<TConfig>(
  options: ManagedConfiguredExtensionOptions<TConfig>,
): (pi: ExtensionAPI) => unknown;
export function defineManagedExtension<TConfig>(
  options: ManagedExtensionOptions | ManagedConfiguredExtensionOptions<TConfig>,
) {
  return function managedExtension(pi: ExtensionAPI) {
    if (!isManagedExtensionEnabled(options.name, options.featureFlag)) return;

    if (!("getConfig" in options) || !options.getConfig) {
      return options.setup(pi);
    }

    const config = options.getConfig();
    return options.setup(pi, config);
  };
}
