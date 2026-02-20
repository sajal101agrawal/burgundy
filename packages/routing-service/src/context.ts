import { logger } from "@concierge/logger";
import type { InterruptClassification, PendingListener } from "@concierge/types";
import { checkPendingListener, resolveListener } from "@concierge/proactive-messaging";

export interface ActiveTask {
  id: string;
  goal: string;
}

export interface RegisteredUser {
  userId: string;
  instanceEndpoint: string;
  accountId?: string;
}

export interface RoutedMessage {
  userId: string;
  from: string;
  body: string;
  classification?: InterruptClassification;
}

export interface RoutingContext {
  lookupUserIdByPhone: (phone: string) => Promise<string | null>;
  getActiveTask: (userId: string) => Promise<ActiveTask | null>;
  dispatchToAgent: (message: RoutedMessage) => Promise<void>;
  checkPendingListener: (userId: string) => Promise<PendingListener | null>;
  resolvePendingListener: (listenerId: string, body: string) => Promise<boolean>;
}

export const createInMemoryRoutingContext = (): RoutingContext & {
  registerUser: (phone: string, user: RegisteredUser) => void;
  setActiveTask: (userId: string, task: ActiveTask | null) => void;
} => {
  const userByPhone = new Map<string, RegisteredUser>();
  const userById = new Map<string, RegisteredUser>();
  const activeTasks = new Map<string, ActiveTask>();

  return {
    registerUser: (phone: string, user: RegisteredUser) => {
      userByPhone.set(phone, user);
      userById.set(user.userId, user);
    },
    setActiveTask: (userId: string, task: ActiveTask | null) => {
      if (task) {
        activeTasks.set(userId, task);
      } else {
        activeTasks.delete(userId);
      }
    },
    lookupUserIdByPhone: async (phone: string) => userByPhone.get(phone)?.userId ?? null,
    getActiveTask: async (userId: string) => activeTasks.get(userId) ?? null,
    dispatchToAgent: async (message: RoutedMessage) => {
      const user = userById.get(message.userId);
      if (!user) {
        logger.warn({ userId: message.userId }, "missing user mapping for dispatch");
        return;
      }
      const inboundPath =
        process.env.OPENCLAW_WHATSAPP_INTERNAL_PATH ??
        process.env.OPENCLAW_INTERNAL_INBOUND_PATH ??
        "/internal/whatsapp/inbound";
      const token = process.env.OPENCLAW_WHATSAPP_INTERNAL_TOKEN?.trim();
      const endpoint = resolveInboundUrl(user.instanceEndpoint, inboundPath);
      const payload = {
        from: message.from,
        body: message.body,
        accountId: user.accountId,
        classification: message.classification,
      };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        logger.warn(
          { status: response.status, responseText, endpoint, userId: user.userId },
          "failed dispatch to agent",
        );
      }
    },
    checkPendingListener: async (userId: string) => {
      return checkPendingListener(userId);
    },
    resolvePendingListener: async (listenerId: string, body: string) => {
      return resolveListener(listenerId, body);
    },
  };
};

function resolveInboundUrl(base: string, path: string): string {
  const trimmedBase = base.trim().replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (trimmedBase.includes(normalizedPath)) {
    return trimmedBase;
  }
  return `${trimmedBase}${normalizedPath}`;
}
