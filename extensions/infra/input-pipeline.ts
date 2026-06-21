import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runInputPipeline } from "./lib/input-pipeline.js";

export default function inputPipelineExtension(pi: ExtensionAPI) {
  pi.on("input", async (event, ctx) => {
    return await runInputPipeline(
      event.text,
      event.images,
      event.source,
      event.streamingBehavior,
      ctx,
    );
  });
}
