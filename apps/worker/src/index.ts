import { Worker } from "bullmq";
import IORedis from "ioredis";
import { logger } from "@concierge/logger";
import { QUEUE_NAMES } from "@concierge/queue";
import { provisionUser } from "@concierge/provisioning-service";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const connection = new IORedis(redisUrl);
const platformApiUrl = process.env.PLATFORM_API_URL || "http://api:3000";
const platformToken = process.env.PLATFORM_INTERNAL_TOKEN?.trim();

const createWorker = (name: string, handler: (job: any) => Promise<void>) => {
  const worker = new Worker(name, handler, { connection });
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

  const instanceEndpoint = payload.instanceEndpoint || "http://openclaw:18800";
  const result = await provisionUser({
    phone: payload.phone,
    personaName: payload.personaName,
    instanceEndpoint,
    userId: payload.userId
  });

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
  logger.info({ jobId: job.id, data: job.data }, "send-whatsapp stub");
});

createWorker(QUEUE_NAMES.EMAIL_ACTIONABILITY, async (job) => {
  logger.info({ jobId: job.id, data: job.data }, "email-actionability stub");
});

createWorker(QUEUE_NAMES.TOOL_DISCOVERY, async (job) => {
  logger.info({ jobId: job.id, data: job.data }, "tool-discovery stub");
});

createWorker(QUEUE_NAMES.AUDIT_LOG_WRITER, async (job) => {
  logger.info({ jobId: job.id, data: job.data }, "audit-log-writer stub");
});

createWorker(QUEUE_NAMES.MEDIA_CLEANUP, async (job) => {
  logger.info({ jobId: job.id, data: job.data }, "media-cleanup stub");
});

logger.info("worker online");
