import { logger } from "@concierge/logger";
import type { InterruptClassification, PendingListener } from "@concierge/types";
import { checkPendingListener, resolveListener } from "@concierge/proactive-messaging";
import { getDb, tasks, users } from "@concierge/db";
import { and, desc, eq } from "drizzle-orm";

export interface ActiveTask {
  id: string;
  goal: string;
}

export interface RegisteredUser {
  userId: string;
  phone?: string;
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
  lookupUserById: (userId: string) => Promise<RegisteredUser | null>;
  getActiveTask: (userId: string) => Promise<ActiveTask | null>;
  dispatchToAgent: (message: RoutedMessage) => Promise<void>;
  checkPendingListener: (userId: string) => Promise<PendingListener | null>;
  resolvePendingListener: (listenerId: string, body: string) => Promise<boolean>;
}

async function dispatchToOpenclawWithRetry(params: {
  endpoint: string;
  token?: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
}): Promise<void> {
  const maxAttempts = Math.max(1, params.maxAttempts ?? 12);
  let backoffMs = 200;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(params.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(params.token ? { authorization: `Bearer ${params.token}` } : {}),
        },
        body: JSON.stringify(params.payload),
      });

      if (response.ok) {
        return;
      }

      const responseText = await response.text().catch(() => "");
      const transient =
        response.status === 503 &&
        (responseText.includes("no_active_listener") || responseText.includes("no_transport"));

      if (transient && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, backoffMs));
        backoffMs = Math.min(2000, Math.floor(backoffMs * 1.75));
        continue;
      }

      logger.warn(
        { status: response.status, responseText, endpoint: params.endpoint },
        "failed dispatch to agent",
      );
      return;
    } catch (error) {
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, backoffMs));
        backoffMs = Math.min(2000, Math.floor(backoffMs * 1.75));
        continue;
      }
      logger.warn(
        { endpoint: params.endpoint, error: String(error) },
        "failed dispatch to agent (network error)",
      );
      return;
    }
  }
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
    lookupUserById: async (userId: string) => userById.get(userId) ?? null,
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
      await dispatchToOpenclawWithRetry({ endpoint, token: token || undefined, payload });
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

export const createDbRoutingContext = (opts?: {
  defaultInstanceEndpoint?: string;
  defaultAccountId?: string;
}): RoutingContext => {
  const db = getDb();
  const defaultInstanceEndpoint =
    opts?.defaultInstanceEndpoint ||
    process.env.OPENCLAW_INTERNAL_BASE_URL ||
    "http://openclaw:18810";
  const defaultAccountId = opts?.defaultAccountId || process.env.WHATSAPP_ACCOUNT_ID || "default";

  return {
    lookupUserIdByPhone: async (phone: string) => {
      const rows = await db.select({ id: users.id }).from(users).where(eq(users.phone, phone)).limit(1);
      return rows[0]?.id ?? null;
    },
    lookupUserById: async (userId: string) => {
      const rows = await db
        .select({
          id: users.id,
          phone: users.phone,
          instanceEndpoint: users.instanceEndpoint,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        userId: row.id,
        phone: row.phone,
        instanceEndpoint: row.instanceEndpoint || defaultInstanceEndpoint,
        accountId: defaultAccountId,
      };
    },
    getActiveTask: async (userId: string) => {
      const rows = await db
        .select({ id: tasks.id, goal: tasks.goal })
        .from(tasks)
        .where(and(eq(tasks.userId, userId), eq(tasks.status, "active")))
        .orderBy(desc(tasks.updatedAt))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return { id: row.id, goal: row.goal };
    },
    dispatchToAgent: async (message: RoutedMessage) => {
      const user = await db
        .select({
          id: users.id,
          instanceEndpoint: users.instanceEndpoint,
        })
        .from(users)
        .where(eq(users.id, message.userId))
        .limit(1)
        .then((rows) => rows[0]);
      if (!user) {
        logger.warn({ userId: message.userId }, "missing user mapping for dispatch");
        return;
      }
      const inboundPath =
        process.env.OPENCLAW_WHATSAPP_INTERNAL_PATH ??
        process.env.OPENCLAW_INTERNAL_INBOUND_PATH ??
        "/internal/whatsapp/inbound";
      const token = process.env.OPENCLAW_WHATSAPP_INTERNAL_TOKEN?.trim();
      const endpoint = resolveInboundUrl(user.instanceEndpoint || defaultInstanceEndpoint, inboundPath);
      const payload = {
        from: message.from,
        body: message.body,
        accountId: defaultAccountId,
        classification: message.classification,
      };
      await dispatchToOpenclawWithRetry({ endpoint, token: token || undefined, payload });
    },
    checkPendingListener: async (userId: string) => {
      return checkPendingListener(userId);
    },
    resolvePendingListener: async (listenerId: string, body: string) => {
      return resolveListener(listenerId, body);
    },
  };
};
