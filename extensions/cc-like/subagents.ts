import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { areSkillsDisabled } from "../infra/lib/bundle-config.js";
import { defineManagedExtension } from "../infra/lib/managed-extension.js";

type ExtensionFactory = (pi: ExtensionAPI) => unknown;
type ResourcePolicy = { skills: boolean; prompts: boolean };
const SUBAGENTS_PACKAGE = "pi-subagents";

function arePromptTemplatesDisabled(argv: readonly string[] = process.argv): boolean {
  return argv.includes("--no-prompt-templates") || argv.includes("-np");
}

export function registerBundledSubagents(
  pi: ExtensionAPI,
  registerSubagents: ExtensionFactory,
  packageRoot: string,
  resourcePolicy: ResourcePolicy = { skills: true, prompts: true },
): unknown {
  const result = registerSubagents(pi);

  pi.on("resources_discover", () => {
    if (!resourcePolicy.skills && !resourcePolicy.prompts) return;
    return {
      ...(resourcePolicy.skills ? { skillPaths: [path.join(packageRoot, "skills")] } : {}),
      ...(resourcePolicy.prompts ? { promptPaths: [path.join(packageRoot, "prompts")] } : {}),
    };
  });

  return result;
}

export default defineManagedExtension({
  name: "subagents",
  featureFlag: "ccLike",
  async setup(pi) {
    const packageRoot = path.dirname(fileURLToPath(import.meta.resolve(SUBAGENTS_PACKAGE)));
    const { default: registerSubagents } = (await import(SUBAGENTS_PACKAGE)) as {
      default: ExtensionFactory;
    };
    return registerBundledSubagents(pi, registerSubagents, packageRoot, {
      skills: !areSkillsDisabled(),
      prompts: !arePromptTemplatesDisabled(),
    });
  },
});
