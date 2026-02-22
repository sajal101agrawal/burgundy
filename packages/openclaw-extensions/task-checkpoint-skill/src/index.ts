import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const CheckpointSaveSchema = Type.Object({
  taskId: Type.String({ description: "Task id to associate with the checkpoint." }),
  userId: Type.Optional(Type.String({ description: "Optional user id override." })),
  state: Type.Unknown({ description: "Serialized task state payload." }),
  goal: Type.Optional(Type.String({ description: "Optional task goal (for initial insert)." })),
  status: Type.Optional(
    Type.Union([
      Type.Literal("pending"),
      Type.Literal("active"),
      Type.Literal("checkpointed"),
      Type.Literal("completed"),
      Type.Literal("failed"),
      Type.Literal("cancelled"),
    ]),
  ),
  phase: Type.Optional(
    Type.Union([
      Type.Literal("discuss"),
      Type.Literal("specify"),
      Type.Literal("confirm"),
      Type.Literal("execute"),
      Type.Literal("verify"),
      Type.Literal("deploy"),
      Type.Literal("deliver"),
    ]),
  ),
});

const CheckpointResumeSchema = Type.Object({
  taskId: Type.String({ description: "Task id to load the checkpoint for." }),
  userId: Type.Optional(Type.String({ description: "Optional user id override." })),
});

type CheckpointRecord = {
  state: unknown;
  savedAt: string;
};

const checkpointStore = new Map<string, CheckpointRecord>();

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = process.env.PLATFORM_INTERNAL_TOKEN?.trim();
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`checkpoint request failed (${response.status}): ${text || response.statusText}`);
  }
  return (await response.json()) as T;
}

const resolveUserId = (override?: string) => {
  const userId = override?.trim() || process.env.PLATFORM_USER_ID?.trim();
  if (!userId) {
    throw new Error("userId required (set PLATFORM_USER_ID or pass userId)");
  }
  return userId;
};

export default {
  id: "task-checkpoint-skill",
  name: "Task Checkpoint",
  description: "Save and resume task checkpoints via the platform API (fallback in-memory).",
  register(api: OpenClawPluginApi) {
    api.registerTool({
      name: "checkpoint_save",
      label: "Checkpoint Save",
      description: "Save a task checkpoint for later resume.",
      parameters: CheckpointSaveSchema,
      async execute(_toolCallId, params) {
        const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
        if (!taskId) {
          throw new Error("taskId required");
        }
        const platformApi = process.env.PLATFORM_API_URL?.trim();
        if (platformApi) {
          const userId = resolveUserId(typeof (params as any).userId === "string" ? (params as any).userId : undefined);
          await postJson(`${platformApi}/internal/tasks/checkpoint`, {
            userId,
            taskId,
            checkpoint: params.state,
            goal: typeof params.goal === "string" ? params.goal : undefined,
            status: typeof params.status === "string" ? params.status : undefined,
            phase: typeof params.phase === "string" ? params.phase : undefined,
          });
        } else {
          checkpointStore.set(taskId, { state: params.state, savedAt: new Date().toISOString() });
        }
        return {
          content: [
            {
              type: "text",
              text: `Checkpoint saved for ${taskId}.`,
            },
          ],
          details: { taskId },
        };
      },
    });

    api.registerTool({
      name: "checkpoint_resume",
      label: "Checkpoint Resume",
      description: "Load a previously saved task checkpoint.",
      parameters: CheckpointResumeSchema,
      async execute(_toolCallId, params) {
        const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
        if (!taskId) {
          throw new Error("taskId required");
        }
        const platformApi = process.env.PLATFORM_API_URL?.trim();
        if (platformApi) {
          const userId = resolveUserId(typeof (params as any).userId === "string" ? (params as any).userId : undefined);
          const result = await postJson<{ found: boolean; checkpoint?: unknown }>(
            `${platformApi}/internal/tasks/checkpoint/get`,
            { userId, taskId },
          );
          if (!result.found) {
            throw new Error(`No checkpoint found for ${taskId}`);
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result.checkpoint ?? null, null, 2),
              },
            ],
            details: { taskId, state: result.checkpoint },
          };
        }

        const record = checkpointStore.get(taskId);
        if (!record) {
          throw new Error(`No checkpoint found for ${taskId}`);
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(record.state, null, 2),
            },
          ],
          details: { taskId, ...record },
        };
      },
    });
  },
};
