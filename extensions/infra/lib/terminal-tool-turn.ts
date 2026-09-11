import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type TerminalToolTurnTracker = {
  reset(): void;
  concluded(): boolean;
};

export function createTerminalToolTurnTracker(pi: ExtensionAPI): TerminalToolTurnTracker {
  const terminationResults: boolean[] = [];

  const reset = () => {
    terminationResults.length = 0;
  };

  pi.on("turn_start", reset);
  pi.on("tool_execution_end", (event) => {
    terminationResults.push(event.result?.terminate === true);
  });

  return {
    reset,
    // Mirror Pi's tool-batch rule: a batch concludes only when every finalized result terminates.
    concluded: () =>
      terminationResults.length > 0 && terminationResults.every((terminate) => terminate),
  };
}
