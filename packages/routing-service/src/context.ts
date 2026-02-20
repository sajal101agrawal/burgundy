import { logger } from "@concierge/logger";
import type { InterruptClassification, PendingListener } from "@concierge/types";
import { checkPendingListener, resolveListener } from "@concierge/proactive-messaging";

export interface ActiveTask {
  id: string;
  goal: string;
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
  registerUser: (phone: string, userId: string) => void;
  setActiveTask: (userId: string, task: ActiveTask | null) => void;
} => {
  const userByPhone = new Map<string, string>();
  const activeTasks = new Map<string, ActiveTask>();

  return {
    registerUser: (phone: string, userId: string) => {
      userByPhone.set(phone, userId);
    },
    setActiveTask: (userId: string, task: ActiveTask | null) => {
      if (task) {
        activeTasks.set(userId, task);
      } else {
        activeTasks.delete(userId);
      }
    },
    lookupUserIdByPhone: async (phone: string) => userByPhone.get(phone) ?? null,
    getActiveTask: async (userId: string) => activeTasks.get(userId) ?? null,
    dispatchToAgent: async (message: RoutedMessage) => {
      logger.info({ message }, "dispatching to agent stub");
    },
    checkPendingListener: async (userId: string) => {
      return checkPendingListener(userId);
    },
    resolvePendingListener: async (listenerId: string, body: string) => {
      return resolveListener(listenerId, body);
    }
  };
};
