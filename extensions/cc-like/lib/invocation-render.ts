import { keyText } from "@earendil-works/pi-coding-agent";

export function formatSkillLikeInvocation(
  name: string,
  theme: { fg: (color: string, text: string) => string },
): string {
  return (
    theme.fg("customMessageLabel", `\x1b[1m[skill]\x1b[22m `) +
    theme.fg("customMessageText", name) +
    theme.fg("dim", ` (${keyText("app.tools.expand")} to expand)`)
  );
}

export function formatExpandedInvocation(
  content: string,
  expanded: boolean,
  theme: { fg: (color: string, text: string) => string },
): string {
  if (!expanded) return "";
  if (!content) return "";
  return `\n${content
    .split("\n")
    .map((line) => theme.fg("toolOutput", line))
    .join("\n")}`;
}
