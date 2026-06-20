import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { refreshBundleConfig, takeBundleConfigErrors } from "./lib/bundle-config.js";

export default function bundleConfigBootstrap(pi: ExtensionAPI) {
  pi.registerFlag("my-pi-settings", {
    description: "Load my-pi-settings.json from an explicit path and ignore autodiscovered bundle config files",
    type: "string",
  });

  pi.on("session_start", async (_event, ctx) => {
    refreshBundleConfig({
      cwd: ctx.cwd,
      isProjectTrusted: ctx.isProjectTrusted(),
      overridePath: pi.getFlag("my-pi-settings") as string | undefined,
    });

    for (const error of takeBundleConfigErrors()) {
      if (ctx.hasUI) {
        ctx.ui.notify(error, "warning");
      } else {
        console.warn(error);
      }
    }
  });
}
