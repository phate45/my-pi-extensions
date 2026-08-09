import { writeFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function captureContextState(pi: ExtensionAPI) {
  pi.on("context", async (event, ctx) => {
    const outputPath = process.env.MY_PI_EXTENSIONS_TEST_OUTPUT;
    if (!outputPath) throw new Error("MY_PI_EXTENSIONS_TEST_OUTPUT is not set");

    await writeFile(
      outputPath,
      JSON.stringify({
        systemPrompt: ctx.getSystemPrompt(),
        skillCommands: pi
          .getCommands()
          .filter((command) => command.source === "skill")
          .map((command) => command.name),
        messages: event.messages,
      }),
    );
    process.exit(0);
  });
}
