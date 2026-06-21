import type {
  ExtensionContext,
  InputEvent,
  InputEventResult,
} from "@earendil-works/pi-coding-agent";

type PipelineImages = InputEvent["images"];

type InputTransformResult = {
  text: string;
  images?: PipelineImages;
};

type InputPipelineArgs = {
  text: string;
  images?: PipelineImages;
  source: InputEvent["source"];
  streamingBehavior?: InputEvent["streamingBehavior"];
  ctx: ExtensionContext;
};

export type InputTransform = (
  input: InputPipelineArgs,
) => Promise<InputTransformResult | undefined> | InputTransformResult | undefined;

export type InputRouter = (
  input: InputPipelineArgs,
) => Promise<InputEventResult | undefined> | InputEventResult | undefined;

type InputPipelineGlobal = typeof globalThis & {
  __myPiInputTransforms?: Map<string, InputTransform>;
  __myPiInputRouters?: Map<string, InputRouter>;
};

const globalState = globalThis as InputPipelineGlobal;

function getTransforms() {
  if (!globalState.__myPiInputTransforms) {
    globalState.__myPiInputTransforms = new Map<string, InputTransform>();
  }
  return globalState.__myPiInputTransforms;
}

function getRouters() {
  if (!globalState.__myPiInputRouters) {
    globalState.__myPiInputRouters = new Map<string, InputRouter>();
  }
  return globalState.__myPiInputRouters;
}

export function registerInputTransform(name: string, transform: InputTransform) {
  getTransforms().set(name, transform);
}

export function registerInputRouter(name: string, router: InputRouter) {
  getRouters().set(name, router);
}

export async function runInputPipeline(
  text: string,
  images: PipelineImages,
  source: InputEvent["source"],
  streamingBehavior: InputEvent["streamingBehavior"],
  ctx: ExtensionContext,
): Promise<InputEventResult> {
  let currentText = text;
  let currentImages = images;

  for (const transform of getTransforms().values()) {
    const result = await transform({
      text: currentText,
      images: currentImages,
      source,
      streamingBehavior,
      ctx,
    });
    if (!result) continue;
    currentText = result.text;
    currentImages = result.images ?? currentImages;
  }

  for (const router of getRouters().values()) {
    const result = await router({
      text: currentText,
      images: currentImages,
      source,
      streamingBehavior,
      ctx,
    });
    if (!result || result.action === "continue") continue;
    if (result.action === "transform") {
      return {
        action: "transform",
        text: result.text,
        images: result.images ?? currentImages,
      };
    }
    return result;
  }

  return currentText !== text || currentImages !== images
    ? { action: "transform", text: currentText, images: currentImages }
    : { action: "continue" };
}

export function resetInputPipelineForTests() {
  globalState.__myPiInputTransforms = new Map<string, InputTransform>();
  globalState.__myPiInputRouters = new Map<string, InputRouter>();
}
