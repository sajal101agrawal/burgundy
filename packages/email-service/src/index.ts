import Fastify from "fastify";
import { logger } from "@concierge/logger";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { QUEUE_NAMES } from "@concierge/queue";

const app = Fastify({ logger: logger as any });

app.post("/email/inbound", async (request) => {
  const payload = request.body as {
    userId?: string;
    to?: string;
    subject?: string;
    body?: string;
  };
  const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
  if (!userId) {
    return { ok: false, error: "userId_required" };
  }
  const to = typeof payload.to === "string" ? payload.to : "";
  const subject = typeof payload.subject === "string" ? payload.subject : "";
  const body = typeof payload.body === "string" ? payload.body : "";

  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_NAMES.EMAIL_ACTIONABILITY, { connection: redis as any });
  await queue.add(
    QUEUE_NAMES.EMAIL_ACTIONABILITY,
    { userId, to, subject, body },
    { removeOnComplete: true, removeOnFail: 50 },
  );
  await queue.close();
  redis.disconnect();

  app.log.info({ userId, to, subject }, "email inbound queued for actionability");
  return { ok: true };
});

const port = Number.parseInt(process.env.PORT || "3004", 10);
app.listen({ port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error, "email service failed to start");
  process.exit(1);
});
