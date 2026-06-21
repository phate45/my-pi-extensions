import os from "node:os";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

export type BundleExtensionSettings = {
  enabled?: boolean;
  config?: Record<string, unknown>;
};

export type BundleSettings = {
  $schemaVersion?: 1;
  featureFlags?: Record<string, boolean>;
  extensions?: Record<string, BundleExtensionSettings>;
};

export type ClaudeMarkdownExpansionConfig = {
  disabled?: boolean;
  disableBash?: boolean;
  disableIncludes?: boolean;
};

const HEADLESS_MODES = new Set(["rpc", "json", "print"]);

type RefreshOptions = {
  cwd: string;
  isProjectTrusted: boolean;
  overridePath?: string;
};

type BundleConfigState = {
  settings: BundleSettings;
  sources: string[];
  errors: string[];
  initialized: boolean;
  preloadOnly: boolean;
};

type BundleConfigGlobal = typeof globalThis & {
  __myPiBundleConfigState?: BundleConfigState;
};

function createDefaultSettings(): BundleSettings {
  return {
    $schemaVersion: 1,
    featureFlags: {},
    extensions: {},
  };
}

const globalState = globalThis as BundleConfigGlobal;

function getState(): BundleConfigState {
  if (!globalState.__myPiBundleConfigState) {
    globalState.__myPiBundleConfigState = {
      settings: createDefaultSettings(),
      sources: [],
      errors: [],
      initialized: false,
      preloadOnly: false,
    };
  }
  if (!globalState.__myPiBundleConfigState.initialized) {
    globalState.__myPiBundleConfigState = preloadBundleConfigFromProcess();
  }
  return globalState.__myPiBundleConfigState;
}

function getOverridePathFromArgv(argv: string[]): string | undefined {
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === "--my-pi-settings") return argv[index + 1];
    if (arg.startsWith("--my-pi-settings=")) return arg.slice("--my-pi-settings=".length);
  }
  return undefined;
}

export function isHeadlessModeArgv(argv: string[]) {
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "-p" || arg === "--print") return true;

    if (arg === "--mode") {
      const mode = argv[index + 1];
      return mode ? HEADLESS_MODES.has(mode) : false;
    }

    if (arg.startsWith("--mode=")) {
      return HEADLESS_MODES.has(arg.slice("--mode=".length));
    }
  }

  return false;
}

function isHeadlessFeatureEnabled() {
  const state = getState();
  return state.settings.featureFlags?.headless === true || isHeadlessModeArgv(process.argv.slice(2));
}

function preloadBundleConfigFromProcess(): BundleConfigState {
  const errors: string[] = [];
  const sources: string[] = [];
  let settings = createDefaultSettings();

  const overridePath = getOverridePathFromArgv(process.argv.slice(2));
  if (overridePath) {
    const overrideFile = resolveOverridePath(overridePath, process.cwd());
    const overrideSettings = loadSettingsFromPath(overrideFile, errors);
    if (overrideSettings) {
      settings = deepMerge(settings, overrideSettings);
      sources.push(overrideFile);
    }
  } else {
    const globalFile = path.join(getAgentDir(), "my-pi-settings.json");
    const globalSettings = loadSettingsFromPath(globalFile, errors);
    if (globalSettings) {
      settings = deepMerge(settings, globalSettings);
      sources.push(globalFile);
    }
  }

  return {
    settings,
    sources,
    errors,
    initialized: true,
    preloadOnly: true,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge<T>(base: T, override: Partial<T>): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override as T;
  }

  const result: Record<string, unknown> = { ...base };
  for (const [key, overrideValue] of Object.entries(override)) {
    if (overrideValue === undefined) continue;

    const baseValue = result[key];
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      result[key] = deepMerge(baseValue, overrideValue);
      continue;
    }

    result[key] = overrideValue;
  }
  return result as T;
}

function resolveHomePath(value: string) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function getAgentDir() {
  return resolveHomePath(process.env.PI_CODING_AGENT_DIR || "~/.pi/agent");
}

function resolveOverridePath(overridePath: string, cwd: string) {
  const expanded = resolveHomePath(overridePath);
  return path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
}

function readSettingsFile(filePath: string): BundleSettings {
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!isPlainObject(parsed)) {
    throw new Error("Expected top-level JSON object");
  }
  return parsed as BundleSettings;
}

function loadSettingsFromPath(filePath: string, errors: string[]) {
  if (!existsSync(filePath)) return undefined;

  try {
    return readSettingsFile(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to load ${filePath}: ${message}`);
    return undefined;
  }
}

export function refreshBundleConfig(options: RefreshOptions) {
  const state = getState();
  const errors: string[] = [];
  const sources: string[] = [];

  let settings = createDefaultSettings();

  if (options.overridePath) {
    const overrideFile = resolveOverridePath(options.overridePath, options.cwd);
    const overrideSettings = loadSettingsFromPath(overrideFile, errors);
    if (overrideSettings) {
      settings = deepMerge(settings, overrideSettings);
      sources.push(overrideFile);
    }
  } else {
    const globalFile = path.join(getAgentDir(), "my-pi-settings.json");
    const globalSettings = loadSettingsFromPath(globalFile, errors);
    if (globalSettings) {
      settings = deepMerge(settings, globalSettings);
      sources.push(globalFile);
    }

    if (options.isProjectTrusted) {
      const localFile = path.join(options.cwd, ".pi", "my-pi-settings.json");
      const localSettings = loadSettingsFromPath(localFile, errors);
      if (localSettings) {
        settings = deepMerge(settings, localSettings);
        sources.push(localFile);
      }
    }
  }

  state.settings = settings;
  state.sources = sources;
  state.errors = errors;
  state.initialized = true;
  state.preloadOnly = false;

  return state;
}

export function getBundleConfig() {
  const state = getState();
  return state.settings;
}

export function getBundleConfigSources() {
  const state = getState();
  return [...state.sources];
}

export function takeBundleConfigErrors() {
  const state = getState();
  const errors = [...state.errors];
  state.errors = [];
  return errors;
}

export function isBundleConfigInitialized() {
  const state = getState();
  return state.initialized;
}

export function isFeatureFlagEnabled(name: string) {
  if (name === "headless") return isHeadlessFeatureEnabled();

  const state = getState();
  return state.settings.featureFlags?.[name] ?? true;
}

export function isExtensionEnabled(name: string) {
  const state = getState();
  return state.settings.extensions?.[name]?.enabled ?? true;
}

export function isManagedExtensionEnabled(name: string, featureFlag?: string) {
  return (featureFlag ? isFeatureFlagEnabled(featureFlag) : true) && isExtensionEnabled(name);
}

export function getExtConfig<T = Record<string, unknown>>(name: string) {
  const state = getState();
  return state.settings.extensions?.[name]?.config as T | undefined;
}

export function isClaudeMarkdownInterpolationDisabled() {
  const config = getExtConfig<ClaudeMarkdownExpansionConfig>("claude-markdown-expansion");
  return config?.disabled === true;
}

export function getClaudeMarkdownExpansionConfig(): ClaudeMarkdownExpansionConfig {
  return getExtConfig<ClaudeMarkdownExpansionConfig>("claude-markdown-expansion") ?? {};
}

export function resetBundleConfigForTests() {
  globalState.__myPiBundleConfigState = {
    settings: createDefaultSettings(),
    sources: [],
    errors: [],
    initialized: false,
    preloadOnly: false,
  };
}

export function setBundleConfigForTests(settings: BundleSettings) {
  globalState.__myPiBundleConfigState = {
    settings: deepMerge(createDefaultSettings(), settings),
    sources: [],
    errors: [],
    initialized: true,
    preloadOnly: false,
  };
}
