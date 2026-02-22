import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { logger } from "@concierge/logger";
import { QUEUE_NAMES } from "@concierge/queue";
import { provisionUser } from "@concierge/provisioning-service";
import { auditLog, getDb, migrateDb, toolRegistry } from "@concierge/db";

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

type EmailActionability = "ACTIONABLE" | "NOTABLE" | "NOISE";
const classifyEmailActionability = (subject: string, body: string): EmailActionability => {
  const text = `${subject}\n${body}`.toLowerCase();
  if (
    /\b(verify|verification|otp|2fa|code|password reset)\b/.test(text) ||
    /\b(invoice|receipt|payment|overdue|failed payment|billing|charge)\b/.test(text) ||
    /\b(alert|security|suspicious|unusual|breach|compromised)\b/.test(text)
  ) {
    return "ACTIONABLE";
  }
  if (/\b(newsletter|weekly|digest|update|changelog)\b/.test(text)) {
    return "NOTABLE";
  }
  return "NOISE";
};

const createWorker = (name: string, handler: (job: any) => Promise<void>) => {
  const worker = new Worker(name, handler, { connection: connection as any });
  worker.on("completed", (job) => logger.info({ name, jobId: job.id }, "job completed"));
  worker.on("failed", (job, err) =>
    logger.error({ name, jobId: job?.id, err }, "job failed")
  );
  return worker;
};

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
    userId: payload.userId
  });

  // Provision/activate the corresponding OpenClaw agent (multi-agent routing + persona files).
  const agentProvisionRes = await fetch(`${platformApiUrl}/internal/openclaw/provision-agent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(platformToken ? { authorization: `Bearer ${platformToken}` } : {})
    },
    body: JSON.stringify({
      userId: result.user.id,
      phone: result.user.phone,
      personaName: result.user.personaName,
      personaFiles: result.personaFiles,
    })
  });
  if (!agentProvisionRes.ok) {
    const text = await agentProvisionRes.text().catch(() => "");
    throw new Error(`openclaw_provision_agent_failed:${agentProvisionRes.status}:${text}`);
  }

  await fetch(`${platformApiUrl}/internal/provision`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(platformToken ? { authorization: `Bearer ${platformToken}` } : {})
    },
    body: JSON.stringify({
      userId: result.user.id,
      phone: result.user.phone,
      personaName: result.user.personaName,
      status: "provisioned",
      instanceEndpoint: result.user.instanceEndpoint
    })
  });

  await fetch(`${platformApiUrl}/internal/message/send`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(platformToken ? { authorization: `Bearer ${platformToken}` } : {})
    },
    body: JSON.stringify({
      userId: result.user.id,
      to: result.user.phone,
      message: `Hi, I'm ${result.user.personaName}. Ready. What can I help you with?`
    })
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
      ...(platformToken ? { authorization: `Bearer ${platformToken}` } : {})
    },
    body: JSON.stringify(payload)
  });
});

createWorker(QUEUE_NAMES.EMAIL_ACTIONABILITY, async (job) => {
  const payload = job.data as { userId: string; to?: string; subject?: string; body?: string };
  const userId = payload.userId;
  const subject = payload.subject || "";
  const body = payload.body || "";

  const classification = classifyEmailActionability(subject, body);
  logger.info({ jobId: job.id, userId, classification }, "email actionability classified");

  if (userId) {
    await db.insert(auditLog).values({
      id: randomUUID(),
      userId,
      eventType: "email.actionability",
      description: `Email classified as ${classification}`,
      metadata: { to: payload.to, subject, classification },
      createdAt: new Date(),
    });
  }
});

createWorker(QUEUE_NAMES.TOOL_DISCOVERY, async (job) => {
  const payload = job.data as {
    toolId: string;
    name: string;
    category?: string[];
    invocationType: string;
    config?: Record<string, unknown>;
    fallbackTo?: string | null;
  };
  if (!payload.toolId || !payload.name) {
    logger.warn({ jobId: job.id, data: job.data }, "tool-discovery missing payload");
    return;
  }
  await db
    .insert(toolRegistry)
    .values({
      toolId: payload.toolId,
      name: payload.name,
      category: payload.category ?? [],
      invocationType: payload.invocationType,
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
        invocationType: payload.invocationType,
        config: payload.config ?? {},
        fallbackTo: payload.fallbackTo ?? null,
        lastValidated: new Date(),
      },
    });
  logger.info({ jobId: job.id, toolId: payload.toolId }, "tool registry upserted");
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
      // ignore
    }
  }
  logger.info({ jobId: job.id, removed }, "media cleanup completed");
});

logger.info("worker online");
