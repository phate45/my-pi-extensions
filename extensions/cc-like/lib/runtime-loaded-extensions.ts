import { ExtensionRunner, type Extension, type SourceInfo } from "@earendil-works/pi-coding-agent";

type LoadedExtensionSnapshot = {
  path: string;
  resolvedPath: string;
  sourceInfo: SourceInfo;
};

type LoadedExtensionsGlobal = typeof globalThis & {
  __piLoadedExtensionsPatchInstalled?: boolean;
  __piLoadedExtensionsOriginalBindCore?: typeof ExtensionRunner.prototype.bindCore;
  __piLoadedExtensionsSnapshot?: LoadedExtensionSnapshot[];
};

const globalState = globalThis as LoadedExtensionsGlobal;

function snapshotExtensions(extensions: Extension[]): LoadedExtensionSnapshot[] {
  return extensions.map((extension) => ({
    path: extension.path,
    resolvedPath: extension.resolvedPath,
    sourceInfo: extension.sourceInfo,
  }));
}

export function installLoadedExtensionsPatch(): void {
  if (globalState.__piLoadedExtensionsPatchInstalled) return;

  const originalBindCore = ExtensionRunner.prototype.bindCore;
  globalState.__piLoadedExtensionsOriginalBindCore = originalBindCore;

  ExtensionRunner.prototype.bindCore = function patchedBindCore(...args: Parameters<typeof originalBindCore>) {
    const current = this as unknown as { extensions?: Extension[] };
    globalState.__piLoadedExtensionsSnapshot = snapshotExtensions(current.extensions ?? []);
    return originalBindCore.apply(this, args);
  };

  globalState.__piLoadedExtensionsPatchInstalled = true;
}

export function getLoadedExtensionsSnapshot(): LoadedExtensionSnapshot[] {
  return globalState.__piLoadedExtensionsSnapshot ?? [];
}

installLoadedExtensionsPatch();
