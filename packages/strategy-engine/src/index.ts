import { getToolByCategory } from "@concierge/tool-registry";
import type { ExecutionStrategy, ToolRegistryEntry } from "@concierge/types";

export interface StrategyInput {
  task: string;
  userId: string;
}

type Category =
  | "presentation"
  | "code"
  | "image"
  | "video"
  | "research"
  | "document"
  | "email"
  | "order"
  | "generic";

const mapInvocationToApproach = (invocation: ToolRegistryEntry["invocationType"]): ExecutionStrategy["approach"] => {
  switch (invocation) {
    case "browser":
      return "browser";
    case "api":
      return "api";
    case "cli":
      return "cli";
    case "inline":
    default:
      return "inline";
  }
};

const detectCategory = (text: string): Category => {
  const t = text.toLowerCase();
  if (/\b(ppt|pptx|deck|presentation|slides?)\b/.test(t)) return "presentation";
  if (/(build|code|program|api|app|frontend|backend|bug|fix)/.test(t)) return "code";
  if (/(photo|image|picture|pic|wallpaper|logo)/.test(t)) return "image";
  if (/\b(video|edit video|clip|reel)\b/.test(t)) return "video";
  if (/(research|report|compare|analy[sz]e|investigate|find out)/.test(t)) return "research";
  if (/(document|docx|pdf|policy|contract)/.test(t)) return "document";
  if (/(email|inbox|mailbox|gmail|outlook|office 365|o365|m365)/.test(t)) return "email";
  if (/(order|buy|purchase|get me)/.test(t)) return "order";
  return "generic";
};

const detectScope = (text: string): "trivial" | "small" | "medium" | "large" | "expert" => {
  const t = text.toLowerCase();
  if (/\bquick|tiny|small fix|minor|typo|rename\b/.test(t)) return "small";
  if (/\bprototype|simple|basic\b/.test(t)) return "medium";
  if (/\bbuild|from scratch|full|end to end|production|deploy|launch\b/.test(t)) return "large";
  if (/\bexpert|complex|hard|advanced\b/.test(t)) return "expert";
  return "medium";
};

const defaultTools: Record<Category, ToolRegistryEntry[]> = {
  presentation: [
    { toolId: "gamma", name: "Gamma", category: ["presentation"], invocationType: "browser", config: {}, qualityScore: 0.72 },
    { toolId: "canva", name: "Canva", category: ["presentation"], invocationType: "browser", config: {}, qualityScore: 0.68 },
    { toolId: "html-to-pptx", name: "HTML-to-PPTX", category: ["presentation"], invocationType: "api", config: {}, qualityScore: 0.55 }
  ],
  code: [
    { toolId: "claude-code-cli", name: "Claude Code CLI", category: ["code"], invocationType: "cli", config: {}, qualityScore: 0.78 },
    { toolId: "agent-inline", name: "Agent Inline", category: ["code"], invocationType: "inline", config: {}, qualityScore: 0.6 }
  ],
  image: [
    { toolId: "dall-e", name: "DALL-E", category: ["image"], invocationType: "api", config: {}, qualityScore: 0.75 },
    { toolId: "midjourney", name: "Midjourney", category: ["image"], invocationType: "browser", config: {}, qualityScore: 0.7 }
  ],
  video: [
    { toolId: "runway", name: "Runway", category: ["video"], invocationType: "browser", config: {}, qualityScore: 0.7 },
    { toolId: "pika", name: "Pika", category: ["video"], invocationType: "browser", config: {}, qualityScore: 0.65 },
    { toolId: "ffmpeg", name: "FFmpeg", category: ["video"], invocationType: "cli", config: {}, qualityScore: 0.55 }
  ],
  research: [
    { toolId: "perplexity", name: "Perplexity", category: ["research"], invocationType: "browser", config: {}, qualityScore: 0.73 },
    { toolId: "agent-inline", name: "Agent Inline", category: ["research"], invocationType: "inline", config: {}, qualityScore: 0.6 }
  ],
  document: [
    { toolId: "agent-inline", name: "Agent Inline", category: ["document"], invocationType: "inline", config: {}, qualityScore: 0.6 }
  ],
  email: [
    { toolId: "browser-email", name: "Browser Email", category: ["email"], invocationType: "browser", config: {}, qualityScore: 0.65 },
    { toolId: "agent-inline", name: "Agent Inline", category: ["email"], invocationType: "inline", config: {}, qualityScore: 0.55 }
  ],
  order: [
    { toolId: "browser-order", name: "Browser Ordering", category: ["order"], invocationType: "browser", config: {}, qualityScore: 0.6 }
  ],
  generic: [
    { toolId: "agent-inline", name: "Agent Inline", category: ["generic"], invocationType: "inline", config: {}, qualityScore: 0.6 }
  ]
};

const chooseTools = async (category: Category): Promise<{ primary: ToolRegistryEntry; fallbacks: string[] }> => {
  let tools: ToolRegistryEntry[] = [];
  try {
    tools = await getToolByCategory(category);
  } catch {
    tools = [];
  }

  if (!tools.length) {
    tools = defaultTools[category] ?? defaultTools.generic;
  }

  // sort by qualityScore desc then name
  tools = [...tools].sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0) || a.name.localeCompare(b.name));

  const [primary, ...rest] = tools;
  return { primary, fallbacks: rest.map((t) => t.toolId) };
};

export const selectStrategy = async (input: StrategyInput): Promise<ExecutionStrategy> => {
  const category = detectCategory(input.task);
  const scope = detectScope(input.task);
  const { primary, fallbacks } = await chooseTools(category);

  const approach = mapInvocationToApproach(primary.invocationType);
  const model: ExecutionStrategy["model"] = scope === "trivial" || scope === "small" ? "sonnet" : "opus";
  const phaseRequired = category !== "generic" || scope !== "trivial";

  return {
    approach,
    primaryTool: primary.toolId,
    fallbackChain: fallbacks,
    model,
    phaseRequired,
  };
};
