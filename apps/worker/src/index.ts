import { Worker } from "bullmq";
import IORedis from "ioredis";
import { logger } from "@concierge/logger";
import { QUEUE_NAMES } from "@concierge/queue";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const connection = new IORedis(redisUrl);

const createWorker = (name: string, handler: (job: any) => Promise<void>) => {
  const worker = new Worker(name, handler, { connection });
  worker.on("completed", (job) => logger.info({ name, jobId: job.id }, "job completed"));
  worker.on("failed", (job, err) =>
    logger.error({ name, jobId: job?.id, err }, "job failed")
  );
  return worker;
};

createWorker(QUEUE_NAMES.PROVISION_USER, async (job) => {
  logger.info({ jobId: job.id, data: job.data }, "provision-user stub");
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
