import type {
  ExtensionAPI,
  ExtensionHandler,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { isManagedExtensionEnabled } from "./bundle-config.js";
import { getExtensionConfig, type ExtensionConfigDefinition } from "./extension-config.js";

export type ManagedExtensionDescriptor = {
  name: string;
  featureFlag?: string;
  config?: ExtensionConfigDefinition<Record<string, unknown>, unknown>;
};

export const managedExtensionDescriptorSymbol = Symbol.for("my-pi.managedExtensionDescriptor");
export const managedExtensionDescriptorsSymbol = Symbol.for("my-pi.managedExtensionDescriptors");

export type ManagedExtensionFactory = ((pi: ExtensionAPI) => unknown) & {
  [managedExtensionDescriptorSymbol]?: ManagedExtensionDescriptor;
  [managedExtensionDescriptorsSymbol]?: readonly ManagedExtensionDescriptor[];
};

export type ManagedExtensionOptions = {
  name: string;
  featureFlag?: string;
  setupOnSessionStart?: boolean;
  setup: (pi: ExtensionAPI) => unknown;
};

export type ManagedConfiguredExtensionOptions<TRaw extends Record<string, unknown>, TConfig> = {
  name: string;
  featureFlag?: string;
  setupOnSessionStart?: boolean;
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

  const setup = (pi: ExtensionAPI) => {
    if (!isManagedExtensionEnabled(options.name, options.featureFlag)) return;
    if (!hasConfig(options)) return options.setup(pi);
    return options.setup(pi, () => getExtensionConfig(options.name, options.config));
  };

  const managedExtension: ManagedExtensionFactory = function managedExtension(pi: ExtensionAPI) {
    if (!options.setupOnSessionStart) return setup(pi);

    let started = false;
    pi.on("session_start", async (event, ctx) => {
      if (started) return;
      started = true;
      const startupHandlers: { handler: ExtensionHandler<SessionStartEvent>; active: boolean }[] =
        [];
      let collecting = true;
      const adaptedPi: ExtensionAPI = {
        ...pi,
        on: new Proxy(pi.on, {
          apply(target, _thisArg, args) {
            const unsubscribe = Reflect.apply(target, pi, args) as () => void;
            if (args[0] !== "session_start" || !collecting) return unsubscribe;
            const entry = { handler: args[1] as ExtensionHandler<SessionStartEvent>, active: true };
            startupHandlers.push(entry);
            return () => {
              entry.active = false;
              unsubscribe();
            };
          },
        }),
      };
      try {
        await setup(adaptedPi);
      } finally {
        collecting = false;
      }
      // Pi snapshots handlers before dispatch, so registrations made during setup
      // need the current startup event once. Future events use normal dispatch.
      const errors: unknown[] = [];
      for (const { handler } of startupHandlers.filter((entry) => entry.active)) {
        try {
          await handler(event, ctx);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length)
        throw new AggregateError(errors, `${options.name} startup handlers failed`);
    });
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

export function getManagedExtensionDescriptors(value: unknown): ManagedExtensionDescriptor[] {
  if (typeof value !== "function") return [];

  const extension = value as ManagedExtensionFactory;
  const descriptors = extension[managedExtensionDescriptorsSymbol];
  if (descriptors) return [...descriptors];

  const descriptor = getManagedExtensionDescriptor(extension);
  return descriptor ? [descriptor] : [];
}

export function composeManagedExtensions(
  extensions: readonly ManagedExtensionFactory[],
): ManagedExtensionFactory {
  const descriptors = extensions.flatMap((extension, index) => {
    const childDescriptors = getManagedExtensionDescriptors(extension);
    if (childDescriptors.length === 0) {
      throw new Error(`Managed extension at index ${index} has no descriptor`);
    }
    return childDescriptors;
  });

  const seenNames = new Set<string>();
  for (const descriptor of descriptors) {
    if (seenNames.has(descriptor.name)) {
      throw new Error(`Duplicate managed extension name: ${descriptor.name}`);
    }
    seenNames.add(descriptor.name);
  }

  const composed: ManagedExtensionFactory = async function composedManagedExtensions(pi) {
    for (const extension of extensions) {
      await extension(pi);
    }
  };

  composed[managedExtensionDescriptorsSymbol] = descriptors;
  return composed;
}
