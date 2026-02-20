import type { InterruptClassification } from "@concierge/types";

export interface InterruptInput {
  activeTaskGoal: string;
  newMessage: string;
}

export interface InterruptResult {
  classification: InterruptClassification;
  rationale: string;
}

export const classifyInterrupt = async (
  input: InterruptInput
): Promise<InterruptResult> => {
  const trimmed = input.newMessage.toLowerCase();
  if (trimmed.includes("cancel") || trimmed.includes("stop")) {
    return { classification: "SUPERSEDE", rationale: "User requested cancellation." };
  }
  return { classification: "ADDITIVE", rationale: "Default additive until model wired." };
};
