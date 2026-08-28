import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defineManagedExtension } from "../infra/lib/managed-extension.js";

type ExtensionFactory = (pi: ExtensionAPI) => unknown;
const PATTY_PACKAGE = "pi-patty-bg-tasks";

export function registerPattyWithoutAgentBg(
  pi: ExtensionAPI,
  registerPatty: ExtensionFactory,
): unknown {
  const registerTool: ExtensionAPI["registerTool"] = (tool) => {
    if (tool.name !== "agent_bg") pi.registerTool(tool);
  };

  const filteredPi = new Proxy(pi, {
    get(target, property) {
      if (property === "registerTool") return registerTool;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return registerPatty(filteredPi);
}

export default defineManagedExtension({
  name: "background-tasks",
  featureFlag: "myStuff",
  async setup(pi) {
    const { default: registerPatty } = (await import(PATTY_PACKAGE)) as {
      default: ExtensionFactory;
    };
    return registerPattyWithoutAgentBg(pi, registerPatty);
  },
});
