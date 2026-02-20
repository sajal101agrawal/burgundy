import type { ExecutionStrategy } from "@concierge/types";

export interface StrategyInput {
  task: string;
  userId: string;
}

export const selectStrategy = async (input: StrategyInput): Promise<ExecutionStrategy> => {
  const lower = input.task.toLowerCase();
  if (lower.includes("presentation") || lower.includes("deck")) {
    return {
      approach: "browser",
      primaryTool: "gamma",
      fallbackChain: ["canva", "html-to-pptx"],
      model: "sonnet",
      phaseRequired: true
    };
  }

  return {
    approach: "inline",
    primaryTool: "agent",
    fallbackChain: [],
    model: "sonnet",
    phaseRequired: false
  };
};
