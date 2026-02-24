import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { eq } from "drizzle-orm";
import { logger } from "@concierge/logger";
import { QUEUE_NAMES } from "@concierge/queue";
import { provisionUser } from "@concierge/provisioning-service";
import { auditLog, getDb, migrateDb, toolRegistry, users } from "@concierge/db";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const platformApiUrl = process.env.PLATFORM_API_URL || "http://api:3000";
const platformToken = process.env.PLATFORM_INTERNAL_TOKEN?.trim();
const db = getDb();

try {
  await migrateDb();
  logger.info("db migrations up to date");
} catch (error) {
  logger.error({ error: String(error) }, "db migration failed");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Anthropic client (optional — degrades gracefully if key not set)
// ---------------------------------------------------------------------------

let anthropicClient: Anthropic | null = null;
const getAnthropic = (): Anthropic | null => {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
};

const callSonnet = async (system: string, userContent: string): Promise<string | null> => {
  const client = getAnthropic();
  if (!client) return null;
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 256,
      system,
      messages: [{ role: "user", content: userContent }],
    });
    const raw = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    return raw.replace(/^```[^\n]*\n?/, "").replace(/\n?```$/, "").trim();
  } catch (err) {
    logger.warn({ err: String(err) }, "anthropic call failed, falling back");
    return null;
  }
};

// ---------------------------------------------------------------------------
// Email actionability
// ---------------------------------------------------------------------------

type EmailActionability = "ACTIONABLE" | "NOTABLE" | "NOISE";

const EMAIL_CLASSIFY_SYSTEM = `Classify an email as ACTIONABLE, NOTABLE, or NOISE and provide a one-sentence summary.

ACTIONABLE: requires attention or action — security alerts, OTP codes, payment failures, invoices, account issues, billing anomalies, access requests, deadlines, or anything that warrants a response or decision.
NOTABLE: informational but not urgent — newsletters, product updates, digests, reports, changelogs.
NOISE: spam, marketing with no clear value, automated system noise requiring no response.

Reply with ONLY valid JSON, no markdown fences: {"classification":"ACTIONABLE"|"NOTABLE"|"NOISE","summary":"one sentence summary of the email"}`;

const classifyEmailKeywords = (subject: string, body: string): EmailActionability => {
  const text = `${subject}\n${body}`.toLowerCase();
  if (
    /\b(verify|verification|otp|2fa|code|password reset|invoice|receipt|payment|overdue|failed payment|billing|charge|alert|security|suspicious|unusual|breach|compromised|access|deadline)\b/.test(
      text,
    )
  ) {
    return "ACTIONABLE";
  }
  if (/\b(newsletter|weekly|digest|update|changelog|release notes)\b/.test(text)) {
    return "NOTABLE";
  }
  return "NOISE";
};

const classifyEmail = async (
  subject: string,
  body: string,
): Promise<{ classification: EmailActionability; summary: string }> => {
  const json = await callSonnet(
    EMAIL_CLASSIFY_SYSTEM,
    `Subject: ${subject}\n\n${body.slice(0, 2000)}`,
  );

  if (json) {
    try {
      const parsed = JSON.parse(json) as { classification?: string; summary?: string };
      const valid: EmailActionability[] = ["ACTIONABLE", "NOTABLE", "NOISE"];
      if (valid.includes(parsed.classification as EmailActionability)) {
        return {
          classification: parsed.classification as EmailActionability,
          summary: parsed.summary ?? subject,
        };
      }
    } catch {
      // fall through
    }
  }

  return {
    classification: classifyEmailKeywords(subject, body),
    summary: subject || body.slice(0, 80),
  };
};

// Dispatch an email alert into the user's OpenClaw agent as a synthetic inbound message.
// The agent will read the email summary, decide whether to notify the user, and act accordingly.
const dispatchEmailAlertToAgent = async (params: {
  userId: string;
  phone: string;
  instanceEndpoint: string;
  summary: string;
  subject: string;
  from: string;
  body: string;
}): Promise<void> => {
  const inboundPath =
    process.env.OPENCLAW_WHATSAPP_INTERNAL_PATH ??
    process.env.OPENCLAW_INTERNAL_INBOUND_PATH ??
    "/internal/whatsapp/inbound";

  const instanceEndpoint = params.instanceEndpoint.replace(/\/$/, "");
  const endpoint = instanceEndpoint.includes(inboundPath)
    ? instanceEndpoint
    : `${instanceEndpoint}${inboundPath}`;

  const token = process.env.OPENCLAW_WHATSAPP_INTERNAL_TOKEN?.trim();

  // Synthetic message: agent treats this as a new task injected from the email monitor
  const syntheticBody = [
    "[EMAIL ALERT — handle this proactively]",
    `From: ${params.from}`,
    `Subject: ${params.subject}`,
    "",
    params.body.slice(0, 1500),
    "",
    "Summarise this email for the user and ask if they want you to take action.",
  ].join("\n");

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        from: params.phone,
        body: syntheticBody,
        accountId: process.env.WHATSAPP_ACCOUNT_ID ?? "default",
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      logger.warn({ status: response.status, text, endpoint }, "email alert dispatch failed");
    }
  } catch (err) {
    logger.warn({ err: String(err), endpoint }, "email alert dispatch error");
  }
};

// ---------------------------------------------------------------------------
// Tool discovery via LLM
// ---------------------------------------------------------------------------

const TOOL_DISCOVERY_SYSTEM = `You are a tool registry assistant for an AI concierge platform. Given a task category or description, suggest the top 3–5 best AI tools or services for that job.

For each tool provide:
- toolId: lowercase kebab-case identifier (e.g. "gamma", "dall-e", "runway-ml")
- name: display name
- category: array of applicable categories (presentation|code|image|video|research|document|email|order|generic)
- invocationType: one of cli|browser|api|inline
- qualityScore: float 0–1 (your best estimate of output quality)
- fallbackTo: toolId of the next best alternative, or null

Reply with ONLY valid JSON array, no markdown fences: [{"toolId":"...","name":"...","category":[...],"invocationType":"...","qualityScore":0.0,"fallbackTo":"..."|null}, ...]`;

const discoverTools = async (
  taskDescription: string,
): Promise<
  Array<{
    toolId: string;
    name: string;
    category: string[];
    invocationType: string;
    qualityScore: number;
    fallbackTo: string | null;
  }>
> => {
  const json = await callSonnet(
    TOOL_DISCOVERY_SYSTEM,
    `Task/category: ${taskDescription.slice(0, 400)}`,
  );

  if (!json) return [];

  try {
    const parsed = JSON.parse(json) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is {
        toolId: string;
        name: string;
        category: string[];
        invocationType: string;
        qualityScore: number;
        fallbackTo: string | null;
      } =>
        typeof (t as Record<string, unknown>).toolId === "string" &&
        typeof (t as Record<string, unknown>).name === "string",
    );
  } catch {
    return [];
  }
};

// ---------------------------------------------------------------------------
// Worker helpers
// ---------------------------------------------------------------------------

const createWorker = (name: string, handler: (job: { id?: string; data: unknown }) => Promise<void>) => {
  const worker = new Worker(name, handler as never, { connection: connection as never });
  worker.on("completed", (job) => logger.info({ name, jobId: job.id }, "job completed"));
  worker.on("failed", (job, err) => logger.error({ name, jobId: job?.id, err }, "job failed"));
  return worker;
};

// ---------------------------------------------------------------------------
// Queue workers
// ---------------------------------------------------------------------------

createWorker(QUEUE_NAMES.PROVISION_USER, async (job) => {
  logger.info({ jobId: job.id, data: job.data }, "provision-user started");
  const payload = job.data as {
    userId: string;
    phone: string;
    personaName: string;
    instanceEndpoint?: string;
  };

  const instanceEndpoint = payload.instanceEndpoint || "http://openclaw:18810";
  const result = await provisionUser({
    phone: payload.phone,
    personaName: payload.personaName,
    instanceEndpoint,
    userId: payload.userId,
  });

  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(platformToken ? { authorization: `Bearer ${platformToken}` } : {}),
  };

  const agentProvisionRes = await fetch(`${platformApiUrl}/internal/openclaw/provision-agent`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      userId: result.user.id,
      phone: result.user.phone,
      personaName: result.user.personaName,
      personaFiles: result.personaFiles,
    }),
  });

  if (!agentProvisionRes.ok) {
    const text = await agentProvisionRes.text().catch(() => "");
    throw new Error(`openclaw_provision_agent_failed:${agentProvisionRes.status}:${text}`);
  }

  await fetch(`${platformApiUrl}/internal/provision`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      userId: result.user.id,
      phone: result.user.phone,
      personaName: result.user.personaName,
      status: "provisioned",
      instanceEndpoint: result.user.instanceEndpoint,
    }),
  });

  await fetch(`${platformApiUrl}/internal/message/send`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      userId: result.user.id,
      to: result.user.phone,
      message: `Hi, I'm ${result.user.personaName}. Ready. What can I help you with?`,
    }),
  });
});

createWorker(QUEUE_NAMES.SEND_WHATSAPP, async (job) => {
  logger.info({ jobId: job.id, data: job.data }, "send-whatsapp");
  const payload = job.data as { userId: string; message: string; to?: string };
  if (!payload.userId || !payload.message) {
    logger.warn({ jobId: job.id, data: job.data }, "send-whatsapp missing payload");
    return;
  }
  await fetch(`${platformApiUrl}/internal/message/send`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(platformToken ? { authorization: `Bearer ${platformToken}` } : {}),
    },
    body: JSON.stringify(payload),
  });
});

createWorker(QUEUE_NAMES.EMAIL_ACTIONABILITY, async (job) => {
  const payload = job.data as {
    userId: string;
    to?: string;
    from?: string;
    subject?: string;
    body?: string;
  };
  const { userId } = payload;
  const subject = payload.subject ?? "";
  const body = payload.body ?? "";
  const from = payload.from ?? "";

  const { classification, summary } = await classifyEmail(subject, body);
  logger.info({ jobId: job.id, userId, classification, summary }, "email classified");

  if (userId) {
    await db.insert(auditLog).values({
      id: randomUUID(),
      userId,
      eventType: "email.actionability",
      description: `Email classified as ${classification}: ${summary}`,
      metadata: { to: payload.to, from, subject, classification, summary },
      createdAt: new Date(),
    });
  }

  // For ACTIONABLE emails, inject the alert into the user's agent so it can proactively
  // summarise and notify the user via WhatsApp.
  if (classification === "ACTIONABLE" && userId) {
    const userRow = await db
      .select({ phone: users.phone, instanceEndpoint: users.instanceEndpoint })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .then((rows) => rows[0]);

    if (userRow?.instanceEndpoint) {
      await dispatchEmailAlertToAgent({
        userId,
        phone: userRow.phone,
        instanceEndpoint: userRow.instanceEndpoint,
        summary,
        subject,
        from,
        body,
      });
    }
  }
});

createWorker(QUEUE_NAMES.TOOL_DISCOVERY, async (job) => {
  const payload = job.data as {
    // Direct registration mode: toolId + name provided, upsert immediately
    toolId?: string;
    name?: string;
    category?: string[];
    invocationType?: string;
    config?: Record<string, unknown>;
    fallbackTo?: string | null;
    // Discovery mode: describe the task, LLM suggests tools
    taskDescription?: string;
  };

  // Direct upsert mode
  if (payload.toolId && payload.name) {
    await db
      .insert(toolRegistry)
      .values({
        toolId: payload.toolId,
        name: payload.name,
        category: payload.category ?? [],
        invocationType: payload.invocationType ?? "inline",
        config: payload.config ?? {},
        fallbackTo: payload.fallbackTo ?? null,
        qualityScore: 0.5,
        lastValidated: new Date(),
      })
      .onConflictDoUpdate({
        target: toolRegistry.toolId,
        set: {
          name: payload.name,
          category: payload.category ?? [],
          invocationType: payload.invocationType ?? "inline",
          config: payload.config ?? {},
          fallbackTo: payload.fallbackTo ?? null,
          lastValidated: new Date(),
        },
      });
    logger.info({ jobId: job.id, toolId: payload.toolId }, "tool registry upserted (direct)");
    return;
  }

  // Discovery mode: use LLM to suggest tools for the given task type
  if (payload.taskDescription) {
    const discovered = await discoverTools(payload.taskDescription);
    if (!discovered.length) {
      logger.warn({ jobId: job.id, taskDescription: payload.taskDescription }, "tool discovery returned no results");
      return;
    }

    for (const tool of discovered) {
      await db
        .insert(toolRegistry)
        .values({
          toolId: tool.toolId,
          name: tool.name,
          category: tool.category,
          invocationType: tool.invocationType,
          config: {},
          fallbackTo: tool.fallbackTo,
          qualityScore: tool.qualityScore,
          lastValidated: new Date(),
        })
        .onConflictDoUpdate({
          target: toolRegistry.toolId,
          set: {
            name: tool.name,
            category: tool.category,
            invocationType: tool.invocationType,
            fallbackTo: tool.fallbackTo,
            qualityScore: tool.qualityScore,
            lastValidated: new Date(),
          },
        });
    }

    logger.info(
      { jobId: job.id, taskDescription: payload.taskDescription, count: discovered.length },
      "tool discovery complete",
    );
    return;
  }

  logger.warn({ jobId: job.id, data: job.data }, "tool-discovery: no toolId or taskDescription in payload");
});

createWorker(QUEUE_NAMES.AUDIT_LOG_WRITER, async (job) => {
  const payload = job.data as {
    userId: string;
    eventType: string;
    description: string;
    metadata?: Record<string, unknown>;
  };
  if (!payload.userId || !payload.eventType || !payload.description) {
    logger.warn({ jobId: job.id, data: job.data }, "audit-log-writer missing payload");
    return;
  }
  await db.insert(auditLog).values({
    id: randomUUID(),
    userId: payload.userId,
    eventType: payload.eventType,
    description: payload.description,
    metadata: payload.metadata ?? {},
    createdAt: new Date(),
  });
});

createWorker(QUEUE_NAMES.MEDIA_CLEANUP, async (job) => {
  const payload = job.data as { paths?: string[] };
  const paths = Array.isArray(payload.paths) ? payload.paths : [];
  let removed = 0;
  for (const p of paths) {
    try {
      await fs.rm(p, { force: true });
      removed += 1;
    } catch {
      // ignore individual file errors
    }
  }
  logger.info({ jobId: job.id, removed }, "media cleanup completed");
});

logger.info("worker online");
