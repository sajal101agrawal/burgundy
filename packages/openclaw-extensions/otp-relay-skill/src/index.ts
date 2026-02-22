import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const OtpRequestSchema = Type.Object({
  message: Type.String({ description: "Message to send to the user requesting the OTP." }),
  userId: Type.Optional(
    Type.String({ description: "Optional user id override. Defaults to PLATFORM_USER_ID." }),
  ),
  timeoutSeconds: Type.Optional(
    Type.Number({
      description: "How long to wait for the user reply before timing out.",
      minimum: 1,
      maximum: 900,
    }),
  ),
});

type OtpRequestParams = {
  message: string;
  userId?: string;
  timeoutSeconds?: number;
};

const DEFAULT_TIMEOUT_SECONDS = 120;

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
    throw new Error(`otp_request failed (${response.status}): ${text || response.statusText}`);
  }
  return (await response.json()) as T;
}

export default {
  id: "otp-relay-skill",
  name: "OTP Relay",
  description: "Pause a task, request an OTP from the user, and resume once received.",
  register(api: OpenClawPluginApi) {
    api.registerTool({
      name: "otp_request",
      label: "OTP Request",
      description: "Send an OTP request to the user and wait for their reply.",
      parameters: OtpRequestSchema,
      async execute(_toolCallId: string, params: unknown) {
        const payload = params as OtpRequestParams;
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
          type: "otp",
          timeoutSeconds,
        });

        const reply = typeof result.response === "string" ? result.response : "";
        return {
          content: [
            {
              type: "text",
              text: reply || "OTP received.",
            },
          ],
          details: { reply },
        };
      },
    });
  },
};
