import type { WebInboundMsg } from "../web/auto-reply/types.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

export type PlatformHookResult = { handled?: boolean } | boolean | null | undefined;
export type InterruptHookResult =
  | { classification?: string | null }
  | string
  | null
  | undefined;

export type PlatformHooks = {
  checkPendingListener?: (params: { senderId: string; message: WebInboundMsg }) =>
    | PlatformHookResult
    | Promise<PlatformHookResult>;
  classifyInterrupt?: (params: { senderId: string; message: WebInboundMsg }) =>
    | InterruptHookResult
    | Promise<InterruptHookResult>;
};

const hookLogger = createSubsystemLogger("platform/hooks");
let cachedModule: PlatformHooks | null = null;
let moduleAttempted = false;

async function resolveHooks(): Promise<PlatformHooks | null> {
  const globalHooks = (globalThis as { OpenClawPlatformHooks?: PlatformHooks }).OpenClawPlatformHooks;
  if (globalHooks && typeof globalHooks === "object") {
    return globalHooks;
  }

  const modulePath = process.env.OPENCLAW_PLATFORM_HOOKS?.trim();
  if (!modulePath) {
    return null;
  }

  if (moduleAttempted) {
    return cachedModule;
  }
  moduleAttempted = true;
  try {
    const mod = (await import(modulePath)) as { default?: PlatformHooks } & PlatformHooks;
    cachedModule = (mod.default ?? mod) as PlatformHooks;
    return cachedModule;
  } catch (error) {
    hookLogger.warn({ error: String(error) }, "platform hooks load failed");
    cachedModule = null;
    return null;
  }
}

export async function checkPendingListener(params: {
  senderId: string;
  message: WebInboundMsg;
}): Promise<boolean> {
  const hooks = await resolveHooks();
  if (!hooks?.checkPendingListener) {
    return false;
  }
  try {
    const result = await hooks.checkPendingListener(params);
    if (typeof result === "boolean") {
      return result;
    }
    if (result && typeof result === "object" && "handled" in result) {
      return Boolean(result.handled);
    }
  } catch (error) {
    hookLogger.warn({ error: String(error) }, "pending listener hook failed");
  }
  return false;
}

export async function classifyInterrupt(params: {
  senderId: string;
  message: WebInboundMsg;
}): Promise<string | undefined> {
  const hooks = await resolveHooks();
  if (!hooks?.classifyInterrupt) {
    return undefined;
  }
  try {
    const result = await hooks.classifyInterrupt(params);
    if (typeof result === "string") {
      return result;
    }
    if (result && typeof result === "object" && "classification" in result) {
      const classification = result.classification;
      return typeof classification === "string" ? classification : undefined;
    }
  } catch (error) {
    hookLogger.warn({ error: String(error) }, "interrupt classifier hook failed");
  }
  return undefined;
}
