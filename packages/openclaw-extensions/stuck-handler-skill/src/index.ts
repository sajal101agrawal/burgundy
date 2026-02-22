import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const StuckEscalateSchema = Type.Object({
  message: Type.String({ description: "Message to send the user describing the stuck state." }),
  userId: Type.Optional(
    Type.String({ description: "Optional user id override. Defaults to PLATFORM_USER_ID." }),
  ),
  timeoutSeconds: Type.Optional(
    Type.Number({
      description: "How long to wait for user input before timing out.",
      minimum: 1,
      maximum: 900,
    }),
  ),
});

type StuckEscalateParams = {
  message: string;
  userId?: string;
  timeoutSeconds?: number;
};

const DEFAULT_TIMEOUT_SECONDS = 600;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = process.env.PLATFORM_INTERNAL_TOKEN?.trim();
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`stuck_escalate failed (${response.status}): ${text || response.statusText}`);
  }
  return (await response.json()) as T;
}

export default {
  id: "stuck-handler-skill",
  name: "Stuck Handler",
  description: "Escalate stuck tasks by asking the user for help and waiting for a response.",
  register(api: OpenClawPluginApi) {
    api.registerTool({
      name: "stuck_escalate",
      label: "Stuck Escalate",
      description: "Send a stuck escalation to the user and wait for their reply.",
      parameters: StuckEscalateSchema,
      async execute(_toolCallId: string, params: unknown) {
        const payload = params as StuckEscalateParams;
        const message = typeof payload.message === "string" ? payload.message.trim() : "";
        if (!message) {
          throw new Error("message required");
        }
        const userId =
          (typeof payload.userId === "string" && payload.userId.trim()) ||
          process.env.PLATFORM_USER_ID?.trim();
        if (!userId) {
          throw new Error("userId required (set PLATFORM_USER_ID or pass userId)");
        }
        const timeoutSeconds =
          typeof payload.timeoutSeconds === "number" && payload.timeoutSeconds > 0
            ? Math.min(payload.timeoutSeconds, 900)
            : DEFAULT_TIMEOUT_SECONDS;

        const baseUrl = process.env.PLATFORM_API_URL?.trim();
        if (!baseUrl) {
          throw new Error("PLATFORM_API_URL is not set");
        }

        const result = await postJson<{ response: string }>(`${baseUrl}/internal/user-ask`, {
          userId,
          message,
          type: "info",
          timeoutSeconds,
        });

        const reply = typeof result.response === "string" ? result.response : "";
        return {
          content: [
            {
              type: "text",
              text: reply || "User responded.",
            },
          ],
          details: { reply },
        };
      },
    });
  },
};
