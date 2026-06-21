import { getExtConfig } from "./bundle-config.js";

export type ExtensionConfigDefinition<TRaw extends Record<string, unknown>, TConfig> = {
  key?: string;
  defaults: TConfig;
  normalize: (raw: TRaw | undefined, defaults: TConfig) => TConfig;
};

export function defineExtensionConfig<TRaw extends Record<string, unknown>, TConfig>(
  definition: ExtensionConfigDefinition<TRaw, TConfig>,
) {
  return definition;
}

export function getExtensionConfig<TRaw extends Record<string, unknown>, TConfig>(
  extensionName: string,
  definition: ExtensionConfigDefinition<TRaw, TConfig>,
): TConfig {
  const raw = getExtConfig<TRaw>(definition.key ?? extensionName);
  return definition.normalize(raw, definition.defaults);
}
