import { basename } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLocalBashOperations, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function fishQuote(value: string) {
  return `'${value.replaceAll("'", `\\'`)}'`;
}

function getFishPath() {
  if (process.env.PI_USER_BASH_SHELL) return process.env.PI_USER_BASH_SHELL;
  if (process.env.SHELL && basename(process.env.SHELL) === "fish") return process.env.SHELL;
  if (existsSync("/usr/bin/fish")) return "/usr/bin/fish";
  return "/bin/fish";
}

function getFishInitPath() {
  return process.env.PI_USER_BASH_FISH_INIT ?? join(homedir(), ".config", "fish", "pi-user-bash.fish");
}

export default function (pi: ExtensionAPI) {
  const local = createLocalBashOperations();

  pi.on("user_bash", () => {
    return {
      operations: {
        exec(command, cwd, options) {
          const fishPath = getFishPath();
          const initPath = getFishInitPath();
          const initCommand = existsSync(initPath) ? `source ${fishQuote(initPath)}` : "";
          const fishCommand = `exec ${shellQuote(fishPath)} -N -C ${shellQuote(initCommand)} -c ${shellQuote(command)}`;
          return local.exec(fishCommand, cwd, options);
        },
      },
    };
  });
}
