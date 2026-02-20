import { classifyInterrupt } from "@concierge/interrupt-classifier";
import type { InterruptClassification } from "@concierge/types";
import type { RoutingContext } from "./context";
import { createInMemoryRoutingContext } from "./context";

export type { RoutingContext, ActiveTask, RoutedMessage } from "./context";

export interface InboundMessage {
  from: string;
  body: string;
}

export interface RouteResult {
  handled: boolean;
  reason: string;
  classification?: InterruptClassification;
}

export const handleInbound = async (
  message: InboundMessage,
  context: RoutingContext
): Promise<RouteResult> => {
  const userId = await context.lookupUserIdByPhone(message.from);
  if (!userId) {
    return { handled: false, reason: "unknown-user" };
  }

  const pending = await context.checkPendingListener(userId);
  if (pending) {
    await context.resolvePendingListener(pending.id, message.body);
    return { handled: true, reason: "pending-listener" };
  }

  const activeTask = await context.getActiveTask(userId);
  let classification: InterruptClassification | undefined;
  if (activeTask) {
    const result = await classifyInterrupt({
      activeTaskGoal: activeTask.goal,
      newMessage: message.body
    });
    classification = result.classification;
  }

  await context.dispatchToAgent({
    userId,
    from: message.from,
    body: message.body,
    classification
  });

  return { handled: true, reason: "dispatched", classification };
};

export const inMemoryRoutingContext = createInMemoryRoutingContext();
