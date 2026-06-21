import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_BUNDLE_FEATURE_FLAGS } from "../extensions/infra/lib/bundle-config.js";
import {
  getManagedExtensionDescriptor,
  type ManagedExtensionDescriptor,
} from "../extensions/infra/lib/managed-extension.js";

type PackageJson = {
  pi?: {
    extensions?: string[];
  };
};

type ExampleBundleSettings = {
  $schemaVersion: 1;
  featureFlags: Record<string, boolean>;
  extensions: Record<string, { enabled: true; config?: Record<string, unknown> }>;
};

export async function loadPackageExtensionPaths(rootDir: string): Promise<string[]> {
  const packageJsonPath = path.join(rootDir, "package.json");
  const packageJson = (await Bun.file(packageJsonPath).json()) as PackageJson;
  const patterns = packageJson.pi?.extensions ?? [];
  const files = new Set<string>();

  for (const pattern of patterns) {
    const relativePattern = path.posix.normalize(pattern.replace(/^\.\//, ""));
    const glob = new Bun.Glob(relativePattern);

    for await (const match of glob.scan({ cwd: rootDir, absolute: true, onlyFiles: true })) {
      files.add(path.resolve(match));
    }
  }

  return [...files].sort();
}

export async function loadManagedExtensionDescriptors(
  entryPaths: string[],
): Promise<ManagedExtensionDescriptor[]> {
  const descriptors: ManagedExtensionDescriptor[] = [];
  const seenNames = new Set<string>();

  for (const entryPath of entryPaths) {
    const module = (await import(pathToFileURL(entryPath).href)) as { default?: unknown };
    const descriptor = getManagedExtensionDescriptor(module.default);
    if (!descriptor) continue;

    if (descriptor.config?.key && descriptor.config.key !== descriptor.name) {
      throw new Error(
        `Managed extension ${descriptor.name} uses config key ${descriptor.config.key}, which generate-config does not support yet`,
      );
    }

    if (seenNames.has(descriptor.name)) {
      throw new Error(`Duplicate managed extension name: ${descriptor.name}`);
    }

    seenNames.add(descriptor.name);
    descriptors.push(descriptor);
  }

  return descriptors.sort((a, b) => a.name.localeCompare(b.name));
}

export function buildExampleBundleSettings(
  descriptors: ManagedExtensionDescriptor[],
): ExampleBundleSettings {
  const discoveredFeatureFlags = new Set(
    descriptors.flatMap((descriptor) => (descriptor.featureFlag ? [descriptor.featureFlag] : [])),
  );

  const featureFlagEntries = [
    ...Object.entries(DEFAULT_BUNDLE_FEATURE_FLAGS),
    ...[...discoveredFeatureFlags]
      .filter((name) => !(name in DEFAULT_BUNDLE_FEATURE_FLAGS))
      .sort((a, b) => a.localeCompare(b))
      .map((name) => [name, true] as const),
  ];

  const extensions = Object.fromEntries(
    descriptors.map((descriptor) => [
      descriptor.name,
      {
        enabled: true as const,
        ...(descriptor.config?.defaults &&
        isRecord(descriptor.config.defaults) &&
        Object.keys(descriptor.config.defaults).length > 0
          ? { config: descriptor.config.defaults }
          : {}),
      },
    ]),
  );

  return {
    $schemaVersion: 1,
    featureFlags: Object.fromEntries(featureFlagEntries),
    extensions,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function generateExampleConfig(rootDir: string): Promise<ExampleBundleSettings> {
  const entryPaths = await loadPackageExtensionPaths(rootDir);
  const descriptors = await loadManagedExtensionDescriptors(entryPaths);
  return buildExampleBundleSettings(descriptors);
}

async function main() {
  const rootDir = path.resolve(import.meta.dir, "..");
  const outputPath = path.join(rootDir, "my-pi-settings.example.json");
  const settings = await generateExampleConfig(rootDir);

  await Bun.write(outputPath, `${JSON.stringify(settings, null, 2)}\n`);
  console.log(`Wrote ${path.relative(rootDir, outputPath)}`);
}

if (import.meta.main) {
  await main();
}
