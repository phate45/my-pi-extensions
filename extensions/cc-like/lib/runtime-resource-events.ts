import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

type ResourceEventListener = () => void;

type ResourcePatchStatus = {
  installed: boolean;
  observed: boolean;
  error?: string;
  notifications: number;
};

type ResourcePatchGlobal = typeof globalThis & {
  __piResourcePatchInstalled?: boolean;
  __piResourcePatchOriginalExtendResources?: typeof DefaultResourceLoader.prototype.extendResources;
  __piResourcePatchListeners?: Set<ResourceEventListener>;
  __piResourcePatchStatus?: ResourcePatchStatus;
};

const globalState = globalThis as ResourcePatchGlobal;

function getStatus(): ResourcePatchStatus {
  if (!globalState.__piResourcePatchStatus) {
    globalState.__piResourcePatchStatus = {
      installed: false,
      observed: false,
      notifications: 0,
    };
  }
  return globalState.__piResourcePatchStatus;
}

function getListeners(): Set<ResourceEventListener> {
  if (!globalState.__piResourcePatchListeners) {
    globalState.__piResourcePatchListeners = new Set<ResourceEventListener>();
  }
  return globalState.__piResourcePatchListeners;
}

export function installResourceEventsPatch(): void {
  const status = getStatus();
  if (globalState.__piResourcePatchInstalled) {
    status.installed = true;
    return;
  }

  const originalExtendResources = DefaultResourceLoader.prototype.extendResources;
  if (typeof originalExtendResources !== "function") {
    status.installed = false;
    status.error = "DefaultResourceLoader.prototype.extendResources is missing";
    return;
  }

  globalState.__piResourcePatchOriginalExtendResources = originalExtendResources;

  DefaultResourceLoader.prototype.extendResources = function patchedExtendResources(
    ...args: Parameters<typeof originalExtendResources>
  ) {
    const result = originalExtendResources.apply(this, args);
    const currentStatus = getStatus();
    currentStatus.observed = true;

    for (const listener of getListeners()) {
      try {
        listener();
        currentStatus.notifications += 1;
      } catch {
        // Ignore listener failures; header rendering should not take down resource loading.
      }
    }

    return result;
  };

  status.installed = true;
  globalState.__piResourcePatchInstalled = true;
}

export function onResourcesExtended(listener: ResourceEventListener): () => void {
  getListeners().add(listener);
  return () => {
    getListeners().delete(listener);
  };
}

export function getResourcePatchStatus(): ResourcePatchStatus {
  const status = getStatus();
  return { ...status };
}

installResourceEventsPatch();
