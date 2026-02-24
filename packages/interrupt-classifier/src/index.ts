import Anthropic from "@anthropic-ai/sdk";
import type { InterruptClassification } from "@concierge/types";

export interface InterruptInput {
  activeTaskGoal: string;
  newMessage: string;
}

export interface InterruptResult {
  classification: InterruptClassification;
  rationale: string;
}

const VALID_CLASSIFICATIONS: InterruptClassification[] = [
  "SUPERSEDE",
  "MODIFY",
  "ADDITIVE",
  "UNRELATED",
];

const SYSTEM_PROMPT = `You are a message classifier for an AI concierge platform. The assistant is actively working on a task and the user sends a new message. Classify how the new message relates to the active task.

Classifications:
- SUPERSEDE: The new message cancels or completely replaces the current task (e.g. "stop", "forget that", "actually do this instead", "cancel it")
- MODIFY: The new message adjusts or adds a constraint to the task currently in progress (e.g. "actually make it blue", "add error handling too", "use TypeScript not Python")
- ADDITIVE: A related follow-up that should queue after the current task completes (e.g. "also add dark mode", "then deploy it")
- UNRELATED: A completely separate request with no relation to the current task

Reply with ONLY valid JSON, no markdown fences: {"classification":"SUPERSEDE"|"MODIFY"|"ADDITIVE"|"UNRELATED","rationale":"one sentence explanation"}`;

const keywordFallback = (message: string): InterruptResult => {
  const t = message.toLowerCase();
  if (/\b(cancel|stop|abort|forget it|never mind|nevermind|ignore that|don't bother)\b/.test(t)) {
    return { classification: "SUPERSEDE", rationale: "Cancellation keyword detected." };
  }
  if (/\b(actually|instead|change it to|make it|use .+ not|switch to)\b/.test(t)) {
    return { classification: "MODIFY", rationale: "Modification keyword detected." };
  }
  return { classification: "ADDITIVE", rationale: "No active task conflict detected." };
};

let client: Anthropic | null = null;

const getClient = (): Anthropic | null => {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  if (!client) {
    client = new Anthropic({ apiKey });
  }
  return client;
};

export const classifyInterrupt = async (input: InterruptInput): Promise<InterruptResult> => {
  const anthropic = getClient();
  if (!anthropic) {
    return keywordFallback(input.newMessage);
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 128,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Active task: ${input.activeTaskGoal.slice(0, 500)}\n\nNew message: ${input.newMessage.slice(0, 500)}`,
        },
      ],
    });

    const raw = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    const json = raw.replace(/^```[^\n]*\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(json) as { classification?: string; rationale?: string };

    const classification = VALID_CLASSIFICATIONS.includes(
      parsed.classification as InterruptClassification,
    )
      ? (parsed.classification as InterruptClassification)
      : "ADDITIVE";

    return { classification, rationale: parsed.rationale ?? "" };
  } catch {
    return keywordFallback(input.newMessage);
  }
};
