import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isManagedExtensionEnabled } from "./bundle-config.js";
import { getExtensionConfig, type ExtensionConfigDefinition } from "./extension-config.js";

export type ManagedExtensionDescriptor = {
  name: string;
  featureFlag?: string;
  config?: ExtensionConfigDefinition<Record<string, unknown>, unknown>;
};

export const managedExtensionDescriptorSymbol = Symbol.for("my-pi.managedExtensionDescriptor");

export type ManagedExtensionFactory = ((pi: ExtensionAPI) => unknown) & {
  [managedExtensionDescriptorSymbol]?: ManagedExtensionDescriptor;
};

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

export function defineManagedExtension(options: ManagedExtensionOptions): ManagedExtensionFactory;
export function defineManagedExtension<TRaw extends Record<string, unknown>, TConfig>(
  options: ManagedConfiguredExtensionOptions<TRaw, TConfig>,
): ManagedExtensionFactory;
export function defineManagedExtension<TRaw extends Record<string, unknown>, TConfig>(
  options: ManagedExtensionOptions | ManagedConfiguredExtensionOptions<TRaw, TConfig>,
) {
  // Config-backed extensions receive a live getter instead of a startup snapshot.
  // Global and CLI-override config exists during extension load, but trusted
  // project-local config only merges on session_start after trust resolves.
  // Handlers that must honor local config should call getConfig() at runtime.
  const descriptor: ManagedExtensionDescriptor = {
    name: options.name,
    ...(options.featureFlag ? { featureFlag: options.featureFlag } : {}),
    ...(hasConfig(options)
      ? { config: options.config as ExtensionConfigDefinition<Record<string, unknown>, unknown> }
      : {}),
  };

  const managedExtension: ManagedExtensionFactory = function managedExtension(pi: ExtensionAPI) {
    if (!isManagedExtensionEnabled(options.name, options.featureFlag)) return;

    if (!hasConfig(options)) {
      return options.setup(pi);
    }

    const getConfig = () => getExtensionConfig(options.name, options.config);
    return options.setup(pi, getConfig);
  };

  managedExtension[managedExtensionDescriptorSymbol] = descriptor;
  return managedExtension;
}

export function getManagedExtensionDescriptor(
  value: unknown,
): ManagedExtensionDescriptor | undefined {
  if (typeof value !== "function") return undefined;
  return (value as ManagedExtensionFactory)[managedExtensionDescriptorSymbol];
}
