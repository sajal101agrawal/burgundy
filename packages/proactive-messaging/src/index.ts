import { randomUUID } from "node:crypto";
import { logger } from "@concierge/logger";
import type { ListenerType, PendingListener } from "@concierge/types";

type ListenerRecord = PendingListener & { resolve: (value: string) => void };
const listeners = new Map<string, ListenerRecord>();

export interface AskOptions {
  type: ListenerType;
  timeoutSeconds: number;
}

export const registerListener = (listener: PendingListener, resolve: (value: string) => void) => {
  listeners.set(listener.id, { ...listener, resolve });
};

export const resolveListener = (id: string, message: string) => {
  const listener = listeners.get(id);
  if (!listener) return false;
  listener.resolve(message);
  listeners.delete(id);
  return true;
};

export const checkPendingListener = (userId: string): ListenerRecord | null => {
  for (const listener of listeners.values()) {
    if (listener.userId === userId) return listener;
  }
  return null;
};

export const userAsk = async (
  userId: string,
  message: string,
  options: AskOptions
): Promise<string> => {
  const listenerId = randomUUID();
  const pending: PendingListener = {
    id: listenerId,
    userId,
    taskId: "pending",
    type: options.type,
    messageSent: message,
    expiresAt: new Date(Date.now() + options.timeoutSeconds * 1000).toISOString()
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      listeners.delete(listenerId);
      reject(new Error("user_ask_timeout"));
    }, options.timeoutSeconds * 1000);

    registerListener(pending, (value) => {
      clearTimeout(timer);
      logger.info({ userId, listenerId }, "user ask resolved");
      resolve(value);
    });

    logger.info({ userId, listenerId, message }, "user ask queued");
  });
};
