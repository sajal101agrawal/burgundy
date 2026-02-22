import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const AccountCreateSchema = Type.Object({
  service: Type.Optional(Type.String({ description: "Service name (e.g. stripe.com)." })),
  url: Type.Optional(Type.String({ description: "Signup URL." })),
  email: Type.Optional(Type.String({ description: "Email to use for the account." })),
  username: Type.Optional(Type.String({ description: "Username to use." })),
  password: Type.Optional(Type.String({ description: "Password to use." })),
  fullName: Type.Optional(Type.String({ description: "Full name to use." })),
  phone: Type.Optional(Type.String({ description: "Phone number to use." })),
  otp: Type.Optional(Type.String({ description: "OTP/verification code if already known." })),
  profile: Type.Optional(Type.String({ description: "Browser profile name." })),
  sendScreenshot: Type.Optional(Type.Boolean({ description: "Send a screenshot to the user." })),
  to: Type.Optional(Type.String({ description: "WhatsApp number to send screenshot to." })),
  userId: Type.Optional(Type.String({ description: "Optional user id override." })),
});

type BrowserTab = { targetId: string; url: string };
type BrowserSnapshotNode = { ref: string; role: string; name: string };
type BrowserSnapshotResult = { ok: true; format: "aria"; targetId: string; url: string; nodes: BrowserSnapshotNode[] };
type BrowserClient = {
  browserOpenTab: (baseUrl: string | undefined, url: string, opts?: { profile?: string }) => Promise<BrowserTab>;
  browserSnapshot: (
    baseUrl: string | undefined,
    opts: { format: "aria"; targetId?: string; refs?: "aria"; interactive?: boolean; profile?: string },
  ) => Promise<BrowserSnapshotResult>;
};

type BrowserActRequest =
  | { kind: "fill"; fields: Array<{ ref: string; type: string; value?: string | number | boolean }>; targetId?: string }
  | { kind: "click"; ref: string; targetId?: string }
  | { kind: "wait"; targetId?: string; loadState?: "load" | "domcontentloaded" | "networkidle"; timeMs?: number };

type BrowserActions = {
  browserAct: (baseUrl: string | undefined, req: BrowserActRequest, opts?: { profile?: string }) => Promise<unknown>;
  browserScreenshotAction: (
    baseUrl: string | undefined,
    opts: { targetId?: string; fullPage?: boolean; type?: "png" | "jpeg"; profile?: string },
  ) => Promise<{ path: string }>;
};

const resolveOpenClawModule = async (candidates: string[]) => {
  const modulePath = fileURLToPath(import.meta.url);
  let cursor = path.dirname(modulePath);
  for (let i = 0; i < 8; i += 1) {
    for (const candidate of candidates) {
      const fullPath = path.join(cursor, candidate);
      if (fs.existsSync(fullPath)) {
        return await import(pathToFileURL(fullPath).href);
      }
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error("OpenClaw browser modules not found");
};

const loadBrowserClient = async (): Promise<BrowserClient> => {
  const mod = await resolveOpenClawModule([
    path.join("dist", "browser", "client.js"),
    path.join("src", "browser", "client.js"),
    path.join("src", "browser", "client.ts"),
  ]);
  if (typeof mod.browserOpenTab !== "function" || typeof mod.browserSnapshot !== "function") {
    throw new Error("OpenClaw browser client unavailable");
  }
  return mod as BrowserClient;
};

const loadBrowserActions = async (): Promise<BrowserActions> => {
  const mod = await resolveOpenClawModule([
    path.join("dist", "browser", "client-actions-core.js"),
    path.join("src", "browser", "client-actions-core.js"),
    path.join("src", "browser", "client-actions-core.ts"),
  ]);
  if (typeof mod.browserAct !== "function" || typeof mod.browserScreenshotAction !== "function") {
    throw new Error("OpenClaw browser actions unavailable");
  }
  return mod as BrowserActions;
};

const normalizeUrl = (service?: string, url?: string) => {
  const trimmedUrl = (url ?? "").trim();
  if (trimmedUrl) return trimmedUrl;
  const trimmedService = (service ?? "").trim();
  if (!trimmedService) return "";
  if (trimmedService.includes(".")) {
    return `https://${trimmedService}`;
  }
  return `https://${trimmedService}.com`;
};

const findRef = (nodes: BrowserSnapshotNode[], keywords: string[], roles?: string[]) => {
  const lowerKeywords = keywords.map((k) => k.toLowerCase());
  return nodes.find((node) => {
    const name = (node.name || "").toLowerCase();
    if (!name) return false;
    if (roles && roles.length > 0 && !roles.includes(node.role)) return false;
    return lowerKeywords.some((keyword) => name.includes(keyword));
  })?.ref;
};

const findAnyRef = (nodes: BrowserSnapshotNode[], keywords: string[], roles?: string[]) => {
  const lowerKeywords = keywords.map((k) => k.toLowerCase());
  return nodes.find((node) => {
    const name = (node.name || "").toLowerCase();
    if (!name) return false;
    if (roles && roles.length > 0 && !roles.includes(node.role)) return false;
    return lowerKeywords.some((keyword) => name.includes(keyword));
  })?.ref;
};

const postPlatformAsk = async (
  userId: string,
  message: string,
  timeoutSeconds = 300,
): Promise<string> => {
  const baseUrl = process.env.PLATFORM_API_URL?.trim();
  if (!baseUrl) {
    throw new Error("PLATFORM_API_URL is required for OTP handling");
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = process.env.PLATFORM_INTERNAL_TOKEN?.trim();
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${baseUrl}/internal/user-ask`, {
    method: "POST",
    headers,
    body: JSON.stringify({ userId, message, type: "otp", timeoutSeconds }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OTP request failed (${response.status}): ${text || response.statusText}`);
  }
  const payload = (await response.json()) as { response?: string };
  return typeof payload.response === "string" ? payload.response : "";
};

const maybeStoreCredentials = async (params: {
  userId: string;
  service?: string;
  url?: string;
  email?: string;
  username?: string;
  password?: string;
}) => {
  const baseUrl = process.env.VAULT_SERVICE_URL?.trim();
  const userId = params.userId;
  if (!baseUrl || !userId) return;
  const serviceName = (params.service || params.url || "").trim();
  if (!serviceName || !params.password) return;
  const entry = {
    id: randomUUID(),
    userId,
    service: serviceName,
    label: serviceName,
    email: params.email ?? null,
    username: params.username ?? null,
    createdBy: "agent",
    sharedWith: [],
    password: params.password,
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
  };
  await fetch(`${baseUrl}/vault/set`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(entry),
  }).catch(() => {
    // best-effort
  });
};

export default {
  id: "account-creator-skill",
  name: "Account Creator",
  description: "Browser-driven account creation helper.",
  register(api: OpenClawPluginApi) {
    api.registerTool({
      name: "account_create",
      label: "Account Create",
      description: "Create a new account on a third-party service via browser automation.",
      parameters: AccountCreateSchema,
      async execute(_toolCallId: string, params: any) {
        const userId =
          (typeof params.userId === "string" && params.userId.trim()) ||
          process.env.PLATFORM_USER_ID?.trim();
        if (!userId) {
          throw new Error("userId required (pass userId or set PLATFORM_USER_ID)");
        }

        const targetUrl = normalizeUrl(params.service as string | undefined, params.url as string | undefined);
        if (!targetUrl) {
          throw new Error("url or service required");
        }

        const { browserOpenTab, browserSnapshot } = await loadBrowserClient();
        const { browserAct, browserScreenshotAction } = await loadBrowserActions();

        const profile = typeof params.profile === "string" ? params.profile : "openclaw";
        const tab = await browserOpenTab(undefined, targetUrl, { profile });

        await browserAct(
          undefined,
          { kind: "wait", targetId: tab.targetId, loadState: "domcontentloaded" },
          { profile },
        );

        let otpValue = typeof params.otp === "string" ? params.otp.trim() : "";
        const maxSteps = 3;
        for (let step = 0; step < maxSteps; step += 1) {
          const snapshot = await browserSnapshot(undefined, {
            format: "aria",
            targetId: tab.targetId,
            refs: "aria",
            interactive: true,
            profile,
          });

          if (!snapshot || snapshot.format !== "aria") {
            throw new Error("Browser snapshot unavailable");
          }

          const nodes = snapshot.nodes ?? [];
          const fields: Array<{ ref: string; type: string; value?: string | number | boolean }> = [];

          const emailRef = findRef(nodes, ["email", "e-mail"], ["textbox", "combobox", "searchbox"]);
          const usernameRef = findRef(nodes, ["username", "user name", "handle"], ["textbox", "combobox", "searchbox"]);
          const passwordRef = findRef(nodes, ["password", "passcode"], ["textbox"]);
          const confirmRef = findRef(nodes, ["confirm password", "retype password", "repeat password"], ["textbox"]);
          const nameRef = findRef(nodes, ["full name", "name"], ["textbox", "combobox", "searchbox"]);
          const phoneRef = findRef(nodes, ["phone", "mobile"], ["textbox", "combobox", "searchbox"]);

          if (typeof params.email === "string" && emailRef) {
            fields.push({ ref: emailRef, type: "text", value: params.email });
          }
          if (typeof params.username === "string" && usernameRef) {
            fields.push({ ref: usernameRef, type: "text", value: params.username });
          }
          if (typeof params.password === "string" && passwordRef) {
            fields.push({ ref: passwordRef, type: "text", value: params.password });
          }
          if (typeof params.password === "string" && confirmRef) {
            fields.push({ ref: confirmRef, type: "text", value: params.password });
          }
          if (typeof params.fullName === "string" && nameRef) {
            fields.push({ ref: nameRef, type: "text", value: params.fullName });
          }
          if (typeof params.phone === "string" && phoneRef) {
            fields.push({ ref: phoneRef, type: "text", value: params.phone });
          }

          if (fields.length > 0) {
            await browserAct(undefined, { kind: "fill", fields, targetId: tab.targetId }, { profile });
          }

          const otpRef = findAnyRef(
            nodes,
            ["verification", "verification code", "otp", "one-time", "security code", "auth code", "2fa"],
            ["textbox", "combobox", "searchbox"],
          );

          if (otpRef && !otpValue) {
            otpValue = await postPlatformAsk(
              userId,
              `Please send the verification code for ${targetUrl}.`,
              300,
            );
          }
          if (otpRef && otpValue) {
            await browserAct(
              undefined,
              { kind: "fill", fields: [{ ref: otpRef, type: "text", value: otpValue }], targetId: tab.targetId },
              { profile },
            );
          }

          const termsRef = findRef(nodes, ["agree", "terms", "privacy", "policy"], ["checkbox", "switch"]);
          if (termsRef) {
            await browserAct(undefined, { kind: "click", ref: termsRef, targetId: tab.targetId }, { profile });
          }

          const submitRef = findAnyRef(
            nodes,
            ["sign up", "create account", "create", "register", "continue", "next", "verify", "confirm", "submit", "get started"],
            ["button", "link"],
          );
          if (submitRef) {
            await browserAct(undefined, { kind: "click", ref: submitRef, targetId: tab.targetId }, { profile });
            await browserAct(
              undefined,
              { kind: "wait", targetId: tab.targetId, loadState: "networkidle", timeMs: 1500 },
              { profile },
            );
            continue;
          }

          if (!submitRef && !otpRef) {
            break;
          }
        }

        await maybeStoreCredentials({
          userId,
          service: typeof params.service === "string" ? params.service : undefined,
          url: targetUrl,
          email: typeof params.email === "string" ? params.email : undefined,
          username: typeof params.username === "string" ? params.username : undefined,
          password: typeof params.password === "string" ? params.password : undefined,
        });

        const screenshot = await browserScreenshotAction(undefined, {
          targetId: tab.targetId,
          fullPage: true,
          type: "png",
          profile,
        });

        const shouldSend = params.sendScreenshot !== false;
        if (shouldSend) {
          const to =
            (typeof params.to === "string" && params.to.trim()) || "";
          if (to) {
            const mediaRoot = path.dirname(screenshot.path);
            await api.runtime.channel.whatsapp.sendMessageWhatsApp(to, "Account creation progress.", {
              verbose: false,
              mediaUrl: screenshot.path,
              mediaLocalRoots: [mediaRoot],
            });
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `Account creation flow initiated for ${targetUrl}.`,
            },
          ],
          details: { targetId: tab.targetId, url: targetUrl, screenshotPath: screenshot.path },
        };
      },
    });
  },
};
