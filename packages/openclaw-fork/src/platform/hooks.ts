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
  const platformApi = process.env.PLATFORM_API_URL?.trim();
  const platformToken = process.env.PLATFORM_INTERNAL_TOKEN?.trim();
  if (!modulePath) {
    if (!platformApi) {
      return null;
    }
    return {
      checkPendingListener: async ({ senderId, message }) => {
        try {
          const response = await fetch(`${platformApi}/internal/pending-listener/check`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(platformToken ? { authorization: `Bearer ${platformToken}` } : {}),
            },
            body: JSON.stringify({ senderId, body: message.body }),
          });
          if (!response.ok) {
            return false;
          }
          const payload = (await response.json().catch(() => null)) as { handled?: boolean } | null;
          return Boolean(payload?.handled);
        } catch (error) {
          hookLogger.warn("platform API pending listener failed", { error: String(error) });
          return false;
        }
      },
      classifyInterrupt: async ({ senderId, message }) => {
        try {
          const response = await fetch(`${platformApi}/internal/interrupt-classify`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(platformToken ? { authorization: `Bearer ${platformToken}` } : {}),
            },
            body: JSON.stringify({ senderId, body: message.body }),
          });
          if (!response.ok) {
            return undefined;
          }
          const payload = (await response.json().catch(() => null)) as
            | { classification?: string | null }
            | null;
          return typeof payload?.classification === "string" ? payload?.classification : undefined;
        } catch (error) {
          hookLogger.warn("platform API interrupt classify failed", { error: String(error) });
          return undefined;
        }
      },
    } satisfies PlatformHooks;
  }

  if (moduleAttempted) {
    return cachedModule;
  }
  moduleAttempted = true;
  try {
    const mod = (await import(modulePath)) as { default?: PlatformHooks } & PlatformHooks;
    cachedModule = mod.default ?? mod;
    return cachedModule;
  } catch (error) {
    hookLogger.warn("platform hooks load failed", { error: String(error) });
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
    hookLogger.warn("pending listener hook failed", { error: String(error) });
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
    hookLogger.warn("interrupt classifier hook failed", { error: String(error) });
  }
  return undefined;
}
