import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { logger } from "@concierge/logger";
import type { ListenerType, PendingListener } from "@concierge/types";

export interface AskOptions {
  type: ListenerType;
  timeoutSeconds: number;
}

const KEY_USER = (userId: string) => `pending_listener:user:${userId}`;
const KEY_ID = (id: string) => `pending_listener:id:${id}`;
const KEY_REPLY = (id: string) => `pending_listener:reply:${id}`;

let redisCmd: Redis | null = null;

const getRedisCmd = (): Redis => {
  if (redisCmd) return redisCmd;
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  redisCmd = new Redis(redisUrl, { maxRetriesPerRequest: null });
  return redisCmd;
};

const createRedisBlocking = (): Redis => {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  // A dedicated connection per `userAsk` so multiple asks can wait concurrently.
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
};

export const checkPendingListener = async (userId: string): Promise<PendingListener | null> => {
  const raw = await getRedisCmd().get(KEY_USER(userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingListener;
    if (!parsed || parsed.userId !== userId) return null;
    return parsed;
  } catch (error) {
    logger.warn({ userId, error: String(error) }, "pending listener JSON parse failed");
    return null;
  }
};

export const resolveListener = async (id: string, message: string): Promise<boolean> => {
  const r = getRedisCmd();
  const userId = await r.get(KEY_ID(id));
  if (!userId) return false;

  // Push reply first so the waiter can unblock even if cleanup fails.
  await r.rpush(KEY_REPLY(id), message);
  await r.expire(KEY_REPLY(id), 60);

  await r.del(KEY_USER(userId));
  await r.del(KEY_ID(id));
  return true;
};

export const userAsk = async (
  userId: string,
  message: string,
  options: AskOptions,
): Promise<string> => {
  const r = getRedisCmd();
  const rb = createRedisBlocking();
  const timeoutSeconds = Math.max(1, Math.min(options.timeoutSeconds, 900));
  const listenerId = randomUUID();

  const pending: PendingListener = {
    id: listenerId,
    userId,
    taskId: "pending",
    type: options.type,
    messageSent: message,
    expiresAt: new Date(Date.now() + timeoutSeconds * 1000).toISOString(),
  };

  const serialized = JSON.stringify(pending);
  const existing = await r.get(KEY_USER(userId));
  if (existing) {
    throw new Error("pending_listener_exists");
  }

  // Order matters: KEY_USER gates resolution (routing checks it first), so write it last.
  await r.del(KEY_REPLY(listenerId));
  await r.set(KEY_ID(listenerId), userId, "EX", timeoutSeconds);
  const created = await r.set(KEY_USER(userId), serialized, "EX", timeoutSeconds, "NX");
  if (created !== "OK") {
    await r.del(KEY_ID(listenerId));
    throw new Error("pending_listener_exists");
  }

  logger.info({ userId, listenerId, type: options.type }, "user ask registered");

  try {
    const reply = await rb.brpop(KEY_REPLY(listenerId), timeoutSeconds);
    if (!reply) {
      // Timeout: cleanup best-effort.
      await r.del(KEY_USER(userId));
      await r.del(KEY_ID(listenerId));
      await r.del(KEY_REPLY(listenerId));
      throw new Error("user_ask_timeout");
    }

    const value = reply[1] ?? "";
    await r.del(KEY_REPLY(listenerId));
    return value;
  } finally {
    rb.disconnect();
  }
};
