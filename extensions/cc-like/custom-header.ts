import path from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { buildStartupSummary, wrapCompactList, type StartupSummary } from "./lib/startup-summary.js";
import { onResourcesExtended, getResourcePatchStatus } from "./lib/runtime-resource-events.js";
import { isExtensionEnabled } from "../my-stuff/lib/bundle-config.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

const DEEP_BLUE: Rgb = [22, 83, 189];
const BLUE: Rgb = [48, 129, 247];
const SKY: Rgb = [93, 171, 255];
const ICE: Rgb = [151, 205, 255];
const PALETTE: Rgb[] = [DEEP_BLUE, BLUE, SKY, ICE, SKY, BLUE];

type Rgb = [number, number, number];

const TITLE_LINES = [
  "  ██████╗  ██╗ ",
  "  ██╔══██╗ ██║ ",
  "  ██████╔╝ ██║ ",
  "  ██╔═══╝  ██║ ",
  "  ██║      ██║ ",
  "  ╚═╝      ╚═╝ ",
];

function mix(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t);
}

function sampleGradient(position: number) {
  const wrapped = ((position % 1) + 1) % 1;
  const scaled = wrapped * PALETTE.length;
  const index = Math.floor(scaled);
  const nextIndex = (index + 1) % PALETTE.length;
  const t = scaled - index;
  const a = PALETTE[index]!;
  const b = PALETTE[nextIndex]!;
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)] as Rgb;
}

function fg([r, g, b]: Rgb, text: string) {
  return `\x1b[38;2;${r};${g};${b}m${text}${RESET}`;
}

function gradientText(text: string, phase: number) {
  const chars = [...text];
  const span = Math.max(chars.length - 1, 1);
  return chars
    .map((char, index) => (char === " " ? char : fg(sampleGradient(index / span + phase), char)))
    .join("");
}

function center(text: string, width: number) {
  const length = [...text].length;
  if (length >= width) return text;
  return `${" ".repeat(Math.floor((width - length) / 2))}${text}`;
}

function renderSection(theme: Theme, title: string, items: string[], width: number): string[] {
  return [theme.fg("mdHeading", `[${title}]`), ...wrapCompactList(items, width).map((line) => theme.fg("dim", line)), ""];
}

function wrapIndentedLine(line: string, width: number): string[] {
  if (visibleWidth(line) <= width) return [line];

  const indentMatch = line.match(/^(\s*)/u);
  const indent = indentMatch?.[1] ?? "";
  const content = line.slice(indent.length);
  const contentWidth = Math.max(10, width - visibleWidth(indent));
  const wrapped = wrapTextWithAnsi(content, contentWidth);
  return wrapped.map((chunk) => `${indent}${chunk}`);
}

function renderPreformattedSection(theme: Theme, title: string, lines: string[], width: number): string[] {
  return [
    theme.fg("mdHeading", `[${title}]`),
    ...lines.flatMap((line) => wrapIndentedLine(line, width).map((wrapped) => theme.fg("dim", wrapped))),
    "",
  ];
}

function renderHeader(width: number, subtitleText: string, theme: Theme, summary: StartupSummary | null) {
  const phase = 0;
  const lines = TITLE_LINES.map((line, row) => gradientText(center(line, width), phase + row * 0.045));
  const subtitle = center(subtitleText, width);
  const out = ["", ...lines, `${BOLD}${gradientText(subtitle, phase + 0.18)}${RESET}`, ""];

  if (!summary) return out;

  if (summary.warnings.length > 0) out.push(...renderSection(theme, "Warnings", summary.warnings, width));
  out.push(...renderSection(theme, "Context", summary.context, width));
  out.push(...renderSection(theme, "Skills", summary.skills, width));
  out.push(...renderSection(theme, "Prompts", summary.prompts, width));
  out.push(...renderPreformattedSection(theme, "Extensions", summary.extensions, width));
  return out;
}

export default function (pi: ExtensionAPI) {
  if (!isExtensionEnabled("custom-header")) return;

  let requestRender: (() => void) | undefined;
  let currentModelId = "no model selected";
  let startupSummary: StartupSummary | null = null;
  let pendingResourceWarningTimer: NodeJS.Timeout | undefined;
  let unsubscribeResourcesExtended: (() => void) | undefined;
  let expectResourcePatchObservation = false;

  function rebuildStartupSummary(ctx: ExtensionContext) {
    startupSummary = buildStartupSummary(ctx, pi, { expectExtendedResources: expectResourcePatchObservation });
    requestRender?.();
  }

  function armResourcePatchWarning(ctx: ExtensionContext) {
    if (pendingResourceWarningTimer) clearTimeout(pendingResourceWarningTimer);
    pendingResourceWarningTimer = setTimeout(() => {
      pendingResourceWarningTimer = undefined;
      expectResourcePatchObservation = true;
      if (!getResourcePatchStatus().observed) rebuildStartupSummary(ctx);
    }, 250);
  }

  function installHeader(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;

    const projectName = path.basename(ctx.cwd) || "session";
    startupSummary = null;
    expectResourcePatchObservation = false;

    ctx.ui.setHeader((tui, theme) => {
      requestRender = () => tui.requestRender();
      return {
        render(width: number) {
          return renderHeader(width, `${currentModelId} · ${projectName}`, theme, startupSummary);
        },
        invalidate() {
          tui.requestRender();
        },
      };
    });

    unsubscribeResourcesExtended?.();
    unsubscribeResourcesExtended = onResourcesExtended(() => {
      if (pendingResourceWarningTimer) {
        clearTimeout(pendingResourceWarningTimer);
        pendingResourceWarningTimer = undefined;
      }
      expectResourcePatchObservation = false;
      rebuildStartupSummary(ctx);
    });

    rebuildStartupSummary(ctx);

  }

  pi.on("session_start", (_event, ctx) => {
    currentModelId = ctx.model?.id ?? "no model selected";
    installHeader(ctx);
  });

  pi.on("resources_discover", (_event, ctx) => {
    expectResourcePatchObservation = true;
    armResourcePatchWarning(ctx);
  });

  pi.on("model_select", (event) => {
    currentModelId = event.model.id;
    requestRender?.();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setHeader(undefined);
    if (pendingResourceWarningTimer) clearTimeout(pendingResourceWarningTimer);
    pendingResourceWarningTimer = undefined;
    unsubscribeResourcesExtended?.();
    unsubscribeResourcesExtended = undefined;
    requestRender = undefined;
    startupSummary = null;
    expectResourcePatchObservation = false;
  });
}
