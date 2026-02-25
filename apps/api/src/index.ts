import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { RegisteredUser } from "@concierge/routing-service";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";
import { getEnv } from "@concierge/config";
import { auditLog, getDb, migrateDb, tasks, users, vaultEntries } from "@concierge/db";
import { logger } from "@concierge/logger";
import { createDbRoutingContext, handleInbound } from "@concierge/routing-service";
import { classifyInterrupt } from "@concierge/interrupt-classifier";
import { QUEUE_NAMES } from "@concierge/queue";
import { userAsk } from "@concierge/proactive-messaging";
import { desc, eq } from "drizzle-orm";
import { callOpenclawGateway } from "./openclaw-gateway.js";

const app = Fastify({ logger: logger as any });
const db = getDb();

try {
  await migrateDb();
  app.log.info("db migrations up to date");
} catch (error) {
  app.log.error({ error: String(error) }, "db migration failed");
  // Fail fast: the API can’t function without tables.
  process.exit(1);
}

await app.register(cors, { origin: true });
await app.register(jwt, { secret: getEnv("JWT_SECRET", "dev-secret") });

const defaultInstanceEndpoint =
  process.env.OPENCLAW_INTERNAL_BASE_URL || "http://openclaw:18810";
const defaultAccountId = process.env.WHATSAPP_ACCOUNT_ID || "default";
const internalToken = process.env.PLATFORM_INTERNAL_TOKEN?.trim();
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const redisConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const queueConnection = redisConnection as any;
const provisionQueue = new Queue(QUEUE_NAMES.PROVISION_USER, { connection: queueConnection });
const sendQueue = new Queue(QUEUE_NAMES.SEND_WHATSAPP, { connection: queueConnection });

const routingContext = createDbRoutingContext({
  defaultInstanceEndpoint,
  defaultAccountId,
});

const pendingAnthropicKeyByUser = new Map<string, Promise<void>>();
const anthropicEnvPath = path.join(process.cwd(), "infra", "docker", ".env");
const openclawOutboundPath =
  process.env.OPENCLAW_WHATSAPP_OUTBOUND_PATH?.trim() || "/internal/whatsapp/send";
const openclawStateDir =
  process.env.OPENCLAW_STATE_DIR?.trim() || "/openclaw-workspace/state";
const openclawAgentId = process.env.OPENCLAW_PRIMARY_AGENT_ID?.trim() || "main";
const openclawInternalToken = process.env.OPENCLAW_WHATSAPP_INTERNAL_TOKEN?.trim();
const openclawGatewayUrl = process.env.OPENCLAW_GATEWAY_URL?.trim() || "";
const openclawGatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN?.trim() || "";

const getAnthropicApiKey = () => process.env.ANTHROPIC_API_KEY?.trim() || "";

function resolvePathInside(baseDir: string, relativePath: string) {
  const base = path.resolve(baseDir);
  const target = path.resolve(baseDir, relativePath);
  if (target === base || !target.startsWith(base + path.sep)) {
    throw new Error(`refusing to operate outside baseDir: ${target}`);
  }
  return target;
}

async function hardResetWhatsAppAuth(accountId: string) {
  const authDir = resolvePathInside(
    openclawStateDir,
    path.join("credentials", "whatsapp", accountId),
  );
  await fs.rm(authDir, { recursive: true, force: true });
}

async function readWhatsAppLinkedE164(accountId: string): Promise<string | null> {
  try {
    const credsPath = resolvePathInside(
      openclawStateDir,
      path.join("credentials", "whatsapp", accountId, "creds.json"),
    );
    const raw = await fs.readFile(credsPath, "utf8");
    const parsed = JSON.parse(raw) as { me?: { id?: unknown } } | undefined;
    const jid = typeof parsed?.me?.id === "string" ? parsed?.me?.id : "";
    const local = jid.split("@")[0] ?? "";
    if (!/^[0-9]{6,20}$/.test(local)) {
      return null;
    }
    return `+${local}`;
  } catch {
    return null;
  }
}

const openclawConfigPath =
  process.env.OPENCLAW_CONFIG_PATH?.trim() || path.join(openclawStateDir, "openclaw.platform.json");

type JsonObject = Record<string, unknown>;

async function readJsonObject(filePath: string): Promise<JsonObject> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as JsonObject;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeJsonObjectAtomic(filePath: string, payload: JsonObject): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now().toString(36)}`;
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  await fs.writeFile(tmpPath, content, "utf8");
  await fs.rename(tmpPath, filePath);
}

async function withFsLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  while (true) {
    try {
      const handle = await fs.open(lockPath, "wx");
      try {
        return await fn();
      } finally {
        await handle.close().catch(() => {});
        await fs.rm(lockPath, { force: true }).catch(() => {});
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      if (Date.now() - start > 10_000) {
        throw new Error(`timed out acquiring lock: ${lockPath}`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

function normalizeE164Loose(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  // Keep it simple for dev: + followed by digits, strip spaces/hyphens.
  const digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  return `+${digits}`;
}

async function upsertWhatsAppAllowFrom(params: { accountId: string; phone: string }) {
  const filePath = path.join(
    openclawStateDir,
    "credentials",
    `whatsapp-${params.accountId}-allowFrom.json`,
  );
  const lockPath = `${filePath}.lock`;
  await withFsLock(lockPath, async () => {
    const existing = await readJsonObject(filePath);
    const current = Array.isArray(existing.allowFrom) ? (existing.allowFrom as unknown[]) : [];
    const normalized = current
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter((v) => v.length > 0);
    const next = Array.from(new Set([...normalized, normalizeE164Loose(params.phone)])).sort();
    await writeJsonObjectAtomic(filePath, { version: 1, allowFrom: next });
  });
}

async function upsertOpenclawAgentBinding(params: {
  agentId: string;
  personaName: string;
  phone: string;
  accountId: string;
}) {
  const lockPath = `${openclawConfigPath}.lock`;
  await withFsLock(lockPath, async () => {
    const cfg = await readJsonObject(openclawConfigPath);

    // Ensure multi-agent list exists and has a stable default agent.
    const agentsObj = (cfg.agents && typeof cfg.agents === "object" ? (cfg.agents as JsonObject) : {});
    const listRaw = Array.isArray(agentsObj.list) ? (agentsObj.list as unknown[]) : [];
    const list = listRaw.filter((v) => v && typeof v === "object" && !Array.isArray(v)) as JsonObject[];

    const ensureAgent = (id: string, patch: (existing: JsonObject) => JsonObject) => {
      const idx = list.findIndex((a) => String(a.id ?? "") === id);
      if (idx >= 0) {
        list[idx] = patch(list[idx] ?? {});
      } else {
        list.push(patch({ id }));
      }
    };

    ensureAgent(openclawAgentId, (existing) => {
      const identity =
        existing.identity && typeof existing.identity === "object" ? (existing.identity as JsonObject) : {};
      return {
        ...existing,
        id: openclawAgentId,
        default: existing.default ?? true,
        identity: {
          ...identity,
          name: typeof identity.name === "string" && identity.name.trim() ? identity.name : "Concierge (Platform)",
        },
      };
    });

    ensureAgent(params.agentId, (existing) => {
      const identity =
        existing.identity && typeof existing.identity === "object" ? (existing.identity as JsonObject) : {};
      return {
        ...existing,
        id: params.agentId,
        default: false,
        identity: {
          ...identity,
          name: params.personaName,
        },
      };
    });

    agentsObj.list = list;
    // NOTE: Do not add custom keys under agents.defaults; OpenClaw validates config strictly.
    // Any platform prompt shaping should be done via AGENTS.md and prompt hooks (plugins).
    const defaults =
      agentsObj.defaults && typeof agentsObj.defaults === "object"
        ? (agentsObj.defaults as JsonObject)
        : {};
    // Remove legacy/invalid keys if present (older platform builds wrote these).
    if ("workspaceNotes" in defaults) {
      delete (defaults as any).workspaceNotes;
    }
    agentsObj.defaults = defaults;
    cfg.agents = agentsObj;

    // Ensure bindings route this sender to their agent.
    const bindingsRaw = Array.isArray(cfg.bindings) ? (cfg.bindings as unknown[]) : [];
    const bindings = bindingsRaw.filter((v) => v && typeof v === "object" && !Array.isArray(v)) as JsonObject[];
    const peerId = normalizeE164Loose(params.phone);
    const nextBindings = bindings.filter((b) => {
      if (String(b.agentId ?? "") !== params.agentId) {
        return true;
      }
      const match = b.match && typeof b.match === "object" ? (b.match as JsonObject) : {};
      if (String(match.channel ?? "") !== "whatsapp") return true;
      const peer = match.peer && typeof match.peer === "object" ? (match.peer as JsonObject) : null;
      if (!peer) return true;
      return String(peer.id ?? "") !== peerId;
    });
    nextBindings.push({
      agentId: params.agentId,
      match: {
        channel: "whatsapp",
        accountId: params.accountId,
        peer: { kind: "direct", id: peerId },
      },
    });
    cfg.bindings = nextBindings;

    // Tighten inbound DM security: only allow senders in allowFrom store.
    const channels = cfg.channels && typeof cfg.channels === "object" ? (cfg.channels as JsonObject) : {};
    const wa = channels.whatsapp && typeof channels.whatsapp === "object" ? (channels.whatsapp as JsonObject) : {};
    wa.dmPolicy = "allowlist";
    // Keep configured allowFrom empty; we maintain the allowFrom store file during provisioning.
    if (Array.isArray(wa.allowFrom)) {
      wa.allowFrom = [];
    }
    channels.whatsapp = wa;
    cfg.channels = channels;

    // Docker-friendly browser defaults:
    // - headless: containers typically have no display server.
    // - noSandbox: Chromium usually requires this inside containers unless running with extra privileges.
    const browser = cfg.browser && typeof cfg.browser === "object" ? (cfg.browser as JsonObject) : {};
    if (browser.enabled === undefined) browser.enabled = true;
    if (browser.headless === undefined) browser.headless = true;
    if (browser.noSandbox === undefined) browser.noSandbox = true;
    // OpenClaw ships a "chrome" profile intended for the Chrome extension relay.
    // In Docker we want the built-in headless Chromium profile.
    if (browser.defaultProfile === undefined) browser.defaultProfile = "openclaw";
    cfg.browser = browser;

    // Ensure our platform plugins are enabled.
    const plugins = cfg.plugins && typeof cfg.plugins === "object" ? (cfg.plugins as JsonObject) : {};
    const entries = plugins.entries && typeof plugins.entries === "object" ? (plugins.entries as JsonObject) : {};
    entries["platform-userid-injector"] = { enabled: true };
    entries["media-send-skill"] = { enabled: true };
    entries["intent-router-skill"] = { enabled: true };
    entries["deck-skill"] = { enabled: true };
    plugins.entries = entries;
    cfg.plugins = plugins;

    // Ensure the gateway auth token stays aligned with the platform's configured token.
    // (If these differ, the web UI won't be able to call the OpenClaw gateway WS methods.)
    if (openclawGatewayToken) {
      const gateway =
        cfg.gateway && typeof cfg.gateway === "object" ? (cfg.gateway as JsonObject) : {};
      const auth = gateway.auth && typeof gateway.auth === "object" ? (gateway.auth as JsonObject) : {};
      auth.mode = "token";
      auth.token = openclawGatewayToken;
      gateway.auth = auth;
      gateway.mode = typeof gateway.mode === "string" && gateway.mode ? gateway.mode : "local";
      // Must be reachable from other containers/services.
      gateway.bind = "lan";
      gateway.port = 18789;
      const controlUi =
        gateway.controlUi && typeof gateway.controlUi === "object"
          ? (gateway.controlUi as JsonObject)
          : {};
      controlUi.enabled = false;
      // Allow the platform API (non-browser WS client) to connect as CONTROL_UI client
      // without device pairing in dev. This is required for web.login.* gateway methods.
      controlUi.allowInsecureAuth = true;
      controlUi.dangerouslyDisableDeviceAuth = true;
      gateway.controlUi = controlUi;
      cfg.gateway = gateway;
    }

    await writeJsonObjectAtomic(openclawConfigPath, cfg);
  });
}

async function writePersonaFilesForAgent(agentId: string, files: { soul: string; agents: string; user: string }) {
  // OpenClaw reads bootstrap files (SOUL.md, AGENTS.md, USER.md) from the per-agent workspace
  // directory at <openclaw-workspace-root>/workspace-{agentId}/, NOT from the state/agents/ path.
  // The two containers share the same Docker volume but mount it at different paths:
  //   API container:      /openclaw-workspace  (OPENCLAW_STATE_DIR = /openclaw-workspace/state)
  //   OpenClaw container: /workspace           (OPENCLAW_WORKSPACE = /workspace)
  // So we resolve the workspace root as the parent of openclawStateDir.
  const workspaceRoot = path.join(openclawStateDir, "..");
  const agentDir = path.join(workspaceRoot, `workspace-${agentId}`);
  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(path.join(agentDir, "SOUL.md"), `${files.soul.trim()}\n`, "utf8");
  await fs.writeFile(path.join(agentDir, "AGENTS.md"), `${files.agents.trim()}\n`, "utf8");
  await fs.writeFile(path.join(agentDir, "USER.md"), `${files.user.trim()}\n`, "utf8");
}

const normalizeAnthropicApiKey = (input: string) => {
  const trimmed = input.trim();
  const match = trimmed.match(/sk-ant-[A-Za-z0-9_-]+/);
  if (match?.[0]) {
    return match[0];
  }
  if (trimmed.includes("=")) {
    const [, ...rest] = trimmed.split("=");
    const candidate = rest.join("=").trim();
    const candidateMatch = candidate.match(/sk-ant-[A-Za-z0-9_-]+/);
    return candidateMatch?.[0] ?? "";
  }
  return "";
};

const PASSWORD_SCHEME = "scrypt:v1";

const hashPassword = (password: string): string => {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32);
  return `${PASSWORD_SCHEME}:${salt.toString("base64")}:${key.toString("base64")}`;
};

const verifyPassword = (password: string, stored: string): boolean => {
  const parts = stored.split(":");
  if (parts.length !== 4) return false;
  const [scheme, version, saltB64, keyB64] = parts;
  if (`${scheme}:${version}` !== PASSWORD_SCHEME) return false;
  const salt = Buffer.from(saltB64 || "", "base64");
  const expected = Buffer.from(keyB64 || "", "base64");
  if (salt.length < 8 || expected.length !== 32) return false;
  const actual = scryptSync(password, salt, 32);
  return timingSafeEqual(actual, expected);
};

const upsertEnvValue = async (filePath: string, key: string, value: string) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  let lines: string[] = [];
  try {
    const existing = await fs.readFile(filePath, "utf8");
    lines = existing.split(/\r?\n/);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  let found = false;
  const nextLines = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) {
    nextLines.push(`${key}=${value}`);
  }
  const content = nextLines.filter((line, idx, arr) => !(idx === arr.length - 1 && line === "")).join("\n");
  await fs.writeFile(filePath, `${content}\n`, "utf8");
};

const writeAnthropicAuthProfile = async (apiKey: string, agentIdOverride?: string) => {
  const agentId = agentIdOverride?.trim() || openclawAgentId;
  const authPath = path.join(
    openclawStateDir,
    "agents",
    agentId,
    "agent",
    "auth-profiles.json"
  );
  await fs.mkdir(path.dirname(authPath), { recursive: true });
  let store: {
    version?: number;
    profiles?: Record<string, any>;
    order?: Record<string, string[]>;
    lastGood?: Record<string, string>;
    usageStats?: Record<string, any>;
  } = {};
  try {
    const raw = await fs.readFile(authPath, "utf8");
    store = JSON.parse(raw) as typeof store;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  const profiles = store.profiles ?? {};
  profiles["anthropic:default"] = {
    type: "api_key",
    provider: "anthropic",
    key: apiKey
  };
  const order = store.order ?? {};
  order.anthropic = ["anthropic:default"];

  const payload = {
    version: store.version ?? 1,
    profiles,
    order,
    lastGood: store.lastGood,
    usageStats: store.usageStats
  };
  await fs.writeFile(authPath, JSON.stringify(payload, null, 2), "utf8");
};

const writeAnthropicAuthProfileForAllAgents = async (apiKey: string) => {
  const agentsRoot = path.join(openclawStateDir, "agents");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(agentsRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    entries = [];
  }
  const agentIds = entries
    .map((e) => e.trim())
    .filter((e) => e.length > 0 && !e.startsWith("."));
  if (agentIds.length === 0) {
    await writeAnthropicAuthProfile(apiKey);
    return;
  }
  await Promise.all(agentIds.map((id) => writeAnthropicAuthProfile(apiKey, id).catch(() => {})));
};

const resolveInstanceForUser = async (
  userId: string,
  override?: { instanceEndpoint?: string; accountId?: string }
): Promise<RegisteredUser | null> => {
  if (override?.instanceEndpoint) {
    return {
      userId,
      instanceEndpoint: override.instanceEndpoint,
      accountId: override.accountId
    };
  }
  return routingContext.lookupUserById(userId);
};

const sendViaOpenclaw = async (params: {
  instanceEndpoint: string;
  accountId?: string;
  to: string;
  message: string;
}) => {
  const endpoint = resolveInboundUrl(
    params.instanceEndpoint,
    openclawOutboundPath
  );
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(openclawInternalToken ? { authorization: `Bearer ${openclawInternalToken}` } : {})
    },
    body: JSON.stringify({
      to: params.to,
      message: params.message,
      accountId: params.accountId
    })
  });
  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(
      `openclaw_send_failed:${response.status}${responseText ? `:${responseText}` : ""}`
    );
  }
};

const requestAnthropicApiKey = async (userId: string, phone: string) => {
  if (getAnthropicApiKey()) {
    return;
  }
  if (pendingAnthropicKeyByUser.has(userId)) {
    return;
  }

  const task = (async () => {
    // If the user is already answering something (OTP/confirm/key prompt), don't start another ask.
    const existingPending = await routingContext.checkPendingListener(userId);
    if (existingPending) {
      return;
    }

    let retry = false;
    const message =
      "I need an Anthropic API key to run. Please reply with your key (starts with sk-ant-). " +
      "I will save it to infra/docker/.env and you can restart the OpenClaw container.";
    await sendQueue.add(
      QUEUE_NAMES.SEND_WHATSAPP,
      { userId, message, to: phone },
      { removeOnComplete: true, removeOnFail: 50 }
    );

    try {
      const response = await userAsk(userId, message, {
        type: "info",
        timeoutSeconds: 900
      });
      const key = normalizeAnthropicApiKey(response);
      if (!key) {
        retry = true;
        await sendQueue.add(
          QUEUE_NAMES.SEND_WHATSAPP,
          {
            userId,
            message:
              "That doesn't look like an Anthropic API key. Please reply with a key that starts with sk-ant-."
          },
          { removeOnComplete: true, removeOnFail: 50 }
        );
        return;
      }
      await upsertEnvValue(anthropicEnvPath, "ANTHROPIC_API_KEY", key);
      process.env.ANTHROPIC_API_KEY = key;
      let applied = false;
      try {
        await writeAnthropicAuthProfileForAllAgents(key);
        applied = true;
      } catch (error) {
        app.log.warn({ userId, error: String(error) }, "failed to write openclaw auth profile");
      }

      await sendQueue.add(
        QUEUE_NAMES.SEND_WHATSAPP,
        {
          userId,
          message: applied
            ? "Anthropic API key saved and applied. You can keep chatting — no restart needed."
            : "Anthropic API key saved. Please restart OpenClaw to apply: docker compose -f infra/docker/docker-compose.yml up -d --build openclaw"
        },
        { removeOnComplete: true, removeOnFail: 50 }
      );
      app.log.info({ userId }, "anthropic api key captured");
    } catch (error) {
      const msg = String(error);
      if (msg.includes("pending_listener_exists")) {
        // Another prompt is already active; that's fine.
        return;
      }
      app.log.warn({ userId, error: msg }, "anthropic api key request failed");
    } finally {
      pendingAnthropicKeyByUser.delete(userId);
      if (retry) {
        void requestAnthropicApiKey(userId, phone);
      }
    }
  })();

  pendingAnthropicKeyByUser.set(userId, task);
};

const requireInternalAuth = (request: any, reply: any): boolean => {
  if (!internalToken) {
    return true;
  }
  const auth = request.headers.authorization as string | undefined;
  if (auth !== `Bearer ${internalToken}`) {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  return true;
};

app.decorate("authenticate", async (request: any, reply: any) => {
  try {
    await request.jwtVerify();
  } catch (error) {
    reply.code(401).send({ error: "unauthorized" });
  }
});

app.get("/health", async () => ({ status: "ok" }));

const taskStatusValues = [
  "pending",
  "active",
  "checkpointed",
  "completed",
  "failed",
  "cancelled"
] as const;

const taskPhaseValues = [
  "discuss",
  "specify",
  "confirm",
  "execute",
  "verify",
  "deploy",
  "deliver"
] as const;

const devUserPhone = process.env.DEV_USER_PHONE;
if (devUserPhone) {
  const isUuid = (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

  const configuredDevUserId = process.env.DEV_USER_ID?.trim();
  const devUserId = configuredDevUserId && isUuid(configuredDevUserId) ? configuredDevUserId : randomUUID();
  const devInstanceEndpoint = process.env.DEV_INSTANCE_ENDPOINT || defaultInstanceEndpoint;
  const now = new Date();
  await db
    .insert(users)
    .values({
      id: devUserId,
      phone: devUserPhone,
      passwordHash: hashPassword("dev-password"),
      personaName: "Concierge",
      platformEmail: "dev@platform.local",
      platformPhone: "+10000000000",
      instanceEndpoint: devInstanceEndpoint,
      provisionedAt: now,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        phone: devUserPhone,
        passwordHash: hashPassword("dev-password"),
        personaName: "Concierge",
        platformEmail: "dev@platform.local",
        platformPhone: "+10000000000",
        instanceEndpoint: devInstanceEndpoint,
        provisionedAt: now,
      } as any,
    });

  app.log.info({ devUserPhone, devUserId, devInstanceEndpoint }, "dev user ensured in DB");
  if (!getAnthropicApiKey()) {
    app.log.warn(
      "ANTHROPIC_API_KEY is not set. Set it in infra/docker/.env or via Web UI (/settings) before running the agent.",
    );
  }

  // Dev convenience: ensure the dev user's phone is routable in OpenClaw without requiring a
  // provisioning job. This also tightens inbound DM policy to allowlist mode.
  try {
    const normalized = normalizeE164Loose(devUserPhone);
    if (normalized) {
      await upsertOpenclawAgentBinding({
        agentId: devUserId,
        personaName: "Concierge",
        phone: normalized,
        accountId: defaultAccountId,
      });
      await upsertWhatsAppAllowFrom({ accountId: defaultAccountId, phone: normalized });
      await writePersonaFilesForAgent(devUserId, {
        soul: `# Concierge

You are Concierge — an autonomous operating assistant, NOT a chatbot.
Your job is to DO things for the user, not describe how to do them.
You act on the real web: you open browsers, log in, navigate, click, fill forms, and deliver results.
You are proactive, resourceful, and transparent about what you are doing and why.
Channel: WhatsApp. Keep messages short and direct. No long explanations unless asked.
`,
        agents: `# AGENTS.md

## Identity
You are an autonomous operating concierge. Every message is a task to be executed, not answered.
Never say "I don't have access", "I can't do that", or "you should try...".
If you have never done something before, reason about how to do it and try.

## Core Loop: REASON → PLAN → ACT → DELIVER
For every task:
1. REASON — Understand what the user actually needs. What is the goal? What service/tool/site can accomplish it?
2. PLAN — Pick the best approach. Always prefer browser automation over inline answers.
3. ACT — Execute with tools. Report each major step briefly as you go ("Searching Zepto for Coke...", "Logging in...", "Adding to cart...").
4. DELIVER — Send the result directly. File? Send it as WhatsApp media. Order placed? Confirm with details. Info? Summarise concisely.

## Browser-First Strategy
For almost every task, open a browser and do it on the web.
- Always start with: target="node" profile="openclaw" (uses user's machine and residential IP — best for sites that block bots).
- If node is unavailable or times out, fallback immediately to: target="host".
- NEVER claim a site is blocked or inaccessible without actually opening it and taking a snapshot.
- NEVER invent errors, HTTP codes, or block messages. Only report what you actually observe.

## Asking for Credentials
When a site requires login, ask for EXACTLY what is needed:
- Email + password flow: ask "What email and password should I use for [site]?" (one message, wait).
- Phone + OTP flow: use the user's WhatsApp number as the phone number automatically. When OTP arrives, call otp_request tool — the user gets a WhatsApp message asking for the OTP, they reply, you continue.
- Never ask for credentials you don't need yet. Ask at the moment you need them.

## Registering with a Temporary Email
When you need to create an account on a new service to complete a task (and the user has no existing account there):
1. Open temp-mail.org (or similar) in the browser to get a fresh disposable email address.
2. Copy that address.
3. Go to the target site and register with that temp email + a generated password.
4. Return to the temp email inbox and click the verification link.
5. Continue the task using the newly created account.
Tell the user: "Registering with a temp email to use [service]..." so they know what is happening.

## OTP Relay
When any site sends an OTP to the user's phone during an ongoing task:
1. Call otp_request tool immediately — this sends the user a WhatsApp message asking for the OTP.
2. Suspend the browser task and wait for the user's reply.
3. Once the user replies with the OTP, type it into the browser.
4. Continue the task as if nothing happened.

## Ordering / Delivery Workflow
When the user asks to order food, groceries, or any product:
1. REASON: What is the item? What kind of service handles it best? (Groceries/quick items → Blinkit/Zepto/Instamart; Food → Swiggy/Zomato; General → Amazon/Flipkart.)
2. If no provider specified, pick the most likely one based on the item and proceed.
3. Open the provider in the browser (node target first).
4. Search for the item, add to cart.
5. Proceed to checkout. Handle login: use user's phone number + OTP relay.
6. STOP at payment and ask: "Ready to place the order: [item] from [provider] — ₹[price]. Confirm?"
7. If user confirms, ask for payment method/details if not already saved.
8. Complete the order and confirm back with order ID / ETA.

If the provider blocks automation: try the next best provider first. Only ask the user to intervene if all alternatives are blocked.

## Presentation / Deck Workflow
When the user asks for a PPT, deck, or slides:
1. REASON: AI deck generators produce better slides faster. Prefer them.
2. Try in order: Gamma (gamma.app) → Canva (canva.com) → Presentations.AI.
3. If the site requires an account and the user has none: register with a temp email (see Registering section above).
4. Input the topic/brief, generate the slides, wait for completion.
5. Find the export/download button. Export as PPTX.
6. Send the PPTX file to the user via WhatsApp media.
7. Ask once: "Want any changes — different theme, more slides, or specific branding?"

## Research Workflow
When the user asks to research, find information, or investigate something:
1. Open Perplexity (perplexity.ai) in the browser for deep, sourced research.
2. Run the query, read the full answer.
3. Summarise the key findings in 3–5 bullet points and send to user.
4. Offer to dig deeper on any specific angle.

## File / Document Workflow
When the user asks to create or convert a document (Word, PDF, spreadsheet, etc.):
1. For simple docs: generate inline using bash tools and send as WhatsApp media.
2. For complex docs: use an appropriate web tool or Claude Code CLI.
3. Always send the actual file, not a link to create it yourself.

## Email Workflow
When the user asks to read, check, or manage email:
1. Ask minimal info: provider (Gmail/Outlook), email address, and password or app-password.
2. Open via browser (node target first, host fallback).
3. Login, handle 2FA via otp_request if needed.
4. List recent messages: from + subject + one-line summary.
5. Ask what action to take (reply, delete, etc.) if relevant.

## Image / Photo Workflow
When the user wants an image or photo:
1. For stock/generic photos: use stock_photo_send tool directly.
2. For AI-generated images: use DALL-E API if key configured; otherwise open Midjourney or Adobe Firefly via browser.
3. Always send as actual WhatsApp media, not as a link.

## Software / Code Workflow
When the user asks to write, fix, or run code:
1. Small fixes/scripts: solve inline.
2. Larger projects: use Claude Code CLI.
3. Deploy only with explicit user confirmation.

## Confirmation Required (Never Skip)
ALWAYS ask explicit confirmation before:
- Placing any order or making any payment.
- Deleting files, accounts, or data.
- Sending emails on the user's behalf.
- Deploying to production.

## Progress Updates
- Acknowledge every task immediately: "On it — [brief description of approach]..."
- Report milestones without waiting to be asked.
- Never go silent for more than ~30 seconds without a brief status update.
- Keep updates short (1 line). Save details for the final delivery.

## Red Lines
- No irreversible actions without explicit user confirmation.
- Never share or store passwords in plain text in replies.
- Never claim you tried something you did not actually execute with a tool.
`,
        user: `# USER\n\nPhone: ${normalized}\n`,
      });
    }
  } catch (error) {
    app.log.warn({ error: String(error) }, "failed to bootstrap dev user OpenClaw config");
  }
}

app.post("/webhook/whatsapp", async (request) => {
  const schema = z.object({
    from: z.string(),
    body: z.string().min(1)
  });
  const payload = schema.parse(request.body);

  const userId = await routingContext.lookupUserIdByPhone(payload.from);
  if (userId && !getAnthropicApiKey()) {
    const pending = await routingContext.checkPendingListener(userId);
    if (!pending) {
      void requestAnthropicApiKey(userId, payload.from);
      return { ok: true, result: { handled: true, reason: "anthropic-key-required" } };
    }
  }

  const result = await handleInbound(payload, routingContext);
  app.log.info({ payload, result }, "whatsapp inbound processed");
  return { ok: true, result };
});

app.post("/internal/pending-listener/check", async (request, reply) => {
  if (!requireInternalAuth(request, reply)) {
    return;
  }
  const schema = z.object({
    senderId: z.string(),
    body: z.string().optional()
  });
  const payload = schema.parse(request.body);

  const userId = await routingContext.lookupUserIdByPhone(payload.senderId);
  if (!userId) {
    return { handled: false };
  }
  const pending = await routingContext.checkPendingListener(userId);
  if (!pending) {
    return { handled: false };
  }
  if (payload.body) {
    const ok = await routingContext.resolvePendingListener(pending.id, payload.body);
    return { handled: ok };
  }
  return { handled: true };
});

app.post("/internal/interrupt-classify", async (request, reply) => {
  if (!requireInternalAuth(request, reply)) {
    return;
  }
  const schema = z.object({
    senderId: z.string(),
    body: z.string()
  });
  const payload = schema.parse(request.body);

  const userId = await routingContext.lookupUserIdByPhone(payload.senderId);
  if (!userId) {
    return { classification: null };
  }
  const activeTask = await routingContext.getActiveTask(userId);
  if (!activeTask) {
    return { classification: null };
  }
  const result = await classifyInterrupt({
    activeTaskGoal: activeTask.goal,
    newMessage: payload.body
  });
  return { classification: result.classification };
});

app.post("/internal/user-ask", async (request, reply) => {
  if (!requireInternalAuth(request, reply)) {
    return;
  }
  const schema = z.object({
    userId: z.string(),
    message: z.string().min(1),
    type: z.enum(["otp", "confirm", "choice", "info"]),
    timeoutSeconds: z.number().int().positive().max(900).optional()
  });
  const payload = schema.parse(request.body);

  await sendQueue.add(
    QUEUE_NAMES.SEND_WHATSAPP,
    { userId: payload.userId, message: payload.message },
    { removeOnComplete: true, removeOnFail: 50 }
  );

  const response = await userAsk(payload.userId, payload.message, {
    type: payload.type,
    timeoutSeconds: payload.timeoutSeconds ?? 300
  });

  return { response };
});

app.post("/internal/tasks/checkpoint", async (request, reply) => {
  if (!requireInternalAuth(request, reply)) {
    return;
  }
  const schema = z.object({
    userId: z.string(),
    taskId: z.string(),
    checkpoint: z.unknown(),
    goal: z.string().optional(),
    status: z.enum(taskStatusValues).optional(),
    phase: z.enum(taskPhaseValues).optional()
  });
  const payload = schema.parse(request.body);
  const now = new Date();

  await db
    .insert(tasks)
    .values({
      id: payload.taskId,
      userId: payload.userId,
      goal: payload.goal ?? "checkpoint",
      status: payload.status ?? "checkpointed",
      phase: payload.phase ?? "execute",
      checkpoint: payload.checkpoint,
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: tasks.id,
      set: {
        checkpoint: payload.checkpoint,
        status: payload.status ?? "checkpointed",
        phase: payload.phase ?? "execute",
        updatedAt: now
      }
    });

  return { ok: true };
});

app.post("/internal/tasks/checkpoint/get", async (request, reply) => {
  if (!requireInternalAuth(request, reply)) {
    return;
  }
  const schema = z.object({
    userId: z.string(),
    taskId: z.string()
  });
  const payload = schema.parse(request.body);
  const rows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, payload.taskId))
    .limit(1);
  const row = rows[0];
  if (!row || row.userId !== payload.userId) {
    return { found: false };
  }
  return { found: true, checkpoint: row.checkpoint };
});

app.post("/auth/register", async (request, reply) => {
  const schema = z.object({
    phone: z.string(),
    password: z.string().min(8),
    personaName: z.string().optional()
  });
  const payload = schema.parse(request.body);

  const phone = normalizeE164Loose(payload.phone);
  if (!phone || phone.length < 6) {
    reply.code(400);
    return { status: "error", error: "invalid_phone" };
  }

  const userId = randomUUID();
  const personaName = payload.personaName || "Concierge";

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phone, phone))
    .limit(1);
  if (existing.length > 0) {
    reply.code(409);
    return { status: "error", error: "phone_already_registered" };
  }

  await db.insert(users).values({
    id: userId,
    phone,
    passwordHash: hashPassword(payload.password),
    personaName,
    instanceEndpoint: defaultInstanceEndpoint,
    createdAt: new Date(),
  });

  await provisionQueue.add(
    QUEUE_NAMES.PROVISION_USER,
    {
      userId,
      phone,
      personaName,
      instanceEndpoint: defaultInstanceEndpoint
    },
    { removeOnComplete: true, removeOnFail: 50 }
  );

  app.log.info({ phone, userId }, "register queued");
  return { status: "queued", userId };
});

app.post("/auth/login", async (request, reply) => {
  const schema = z.object({
    phone: z.string(),
    password: z.string().min(8)
  });
  const payload = schema.parse(request.body);
  const phone = normalizeE164Loose(payload.phone);
  if (!phone) {
    reply.code(400);
    return { error: "invalid_phone" };
  }

  const row = await db
    .select({
      id: users.id,
      phone: users.phone,
      passwordHash: users.passwordHash,
      personaName: users.personaName,
    })
    .from(users)
    .where(eq(users.phone, phone))
    .limit(1)
    .then((rows) => rows[0]);

  if (!row || !verifyPassword(payload.password, row.passwordHash)) {
    reply.code(401);
    return { error: "invalid_credentials" };
  }

  const token = app.jwt.sign({ sub: row.id }, { expiresIn: "15m" });
  return { token, user: { id: row.id, phone: row.phone, personaName: row.personaName } };
});

app.get("/me/vault", { preHandler: [(app as any).authenticate] }, async (request: any, reply: any) => {
  const userId = request.user?.sub as string | undefined;
  if (!userId) {
    reply.code(401);
    return { error: "unauthorized" };
  }
  const rows = await db
    .select()
    .from(vaultEntries)
    .where(eq(vaultEntries.userId, userId))
    .orderBy(desc(vaultEntries.createdAt))
    .limit(200);

  const entries = rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    service: row.service,
    label: row.label,
    email: row.email,
    username: row.username,
    twoFaType: row.twoFaType,
    createdBy: row.createdBy,
    sharedWith: row.sharedWith,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
  }));

  return { entries };
});

app.get("/me/tasks", { preHandler: [(app as any).authenticate] }, async (request: any, reply: any) => {
  const userId = request.user?.sub as string | undefined;
  if (!userId) {
    reply.code(401);
    return { error: "unauthorized" };
  }
  const rows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.userId, userId))
    .orderBy(desc(tasks.updatedAt))
    .limit(200);
  return { tasks: rows };
});

app.get("/me/audit", { preHandler: [(app as any).authenticate] }, async (request: any, reply: any) => {
  const userId = request.user?.sub as string | undefined;
  if (!userId) {
    reply.code(401);
    return { error: "unauthorized" };
  }
  const rows = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.userId, userId))
    .orderBy(desc(auditLog.createdAt))
    .limit(500);
  return { events: rows };
});

app.get(
  "/me/anthropic-key",
  { preHandler: [(app as any).authenticate] },
  async (_request: any, reply: any) => {
    // Never return the key, only presence.
    reply.code(200);
    return { configured: Boolean(getAnthropicApiKey()) };
  },
);

app.post(
  "/me/anthropic-key",
  { preHandler: [(app as any).authenticate] },
  async (request: any, reply: any) => {
    const schema = z.object({ apiKey: z.string().min(1) });
    const payload = schema.parse(request.body);
    const key = normalizeAnthropicApiKey(payload.apiKey);
    if (!key) {
      reply.code(400);
      return { error: "invalid_anthropic_key" };
    }
    await upsertEnvValue(anthropicEnvPath, "ANTHROPIC_API_KEY", key);
    process.env.ANTHROPIC_API_KEY = key;

    let applied = false;
    try {
      await writeAnthropicAuthProfileForAllAgents(key);
      applied = true;
    } catch (error) {
      app.log.warn({ error: String(error) }, "failed to write openclaw auth profile");
    }

    return { ok: true, applied };
  },
);

app.post(
  "/me/whatsapp/login/start",
  { preHandler: [(app as any).authenticate] },
  async (request: any, reply: any) => {
    const schema = z.object({
      force: z.boolean().optional(),
      accountId: z.string().optional(),
    });
    const payload = schema.parse(request.body ?? {});

    if (!openclawGatewayUrl) {
      reply.code(500);
      return { error: "openclaw_gateway_not_configured" };
    }

    const accountId = payload.accountId ?? defaultAccountId;

    // Force relink should clear any corrupted/logged-out web session first,
    // otherwise Baileys may fail to emit a new QR and just disconnect.
    if (payload.force) {
      try {
        await callOpenclawGateway({
          url: openclawGatewayUrl,
          token: openclawGatewayToken || undefined,
          method: "channels.logout",
          params: { channel: "whatsapp", accountId },
          timeoutMs: 20_000,
        });
      } catch (error) {
        app.log.warn({ error: String(error) }, "channels.logout failed (continuing)");
      }
      // In practice, Baileys can keep limping along with a partially-written creds.json.
      // A hard reset (delete the auth dir in the shared Docker volume) makes force-relink deterministic.
      try {
        await hardResetWhatsAppAuth(accountId);
      } catch (error) {
        app.log.warn({ error: String(error) }, "failed to hard reset whatsapp auth dir (continuing)");
      }
    }

    const result = await callOpenclawGateway<{ qrDataUrl?: string; message: string }>({
      url: openclawGatewayUrl,
      token: openclawGatewayToken || undefined,
      method: "web.login.start",
      params: {
        force: Boolean(payload.force),
        accountId,
        timeoutMs: 30_000,
      },
      timeoutMs: 35_000,
    });

    return { ok: true, result };
  },
);

app.post(
  "/me/whatsapp/login/wait",
  { preHandler: [(app as any).authenticate] },
  async (request: any, reply: any) => {
    const schema = z.object({
      accountId: z.string().optional(),
      timeoutMs: z.number().int().positive().max(60_000).optional(),
    });
    const payload = schema.parse(request.body ?? {});

    if (!openclawGatewayUrl) {
      reply.code(500);
      return { error: "openclaw_gateway_not_configured" };
    }

    const result = await callOpenclawGateway<{ connected: boolean; message: string }>({
      url: openclawGatewayUrl,
      token: openclawGatewayToken || undefined,
      method: "web.login.wait",
      params: {
        accountId: payload.accountId ?? defaultAccountId,
        timeoutMs: payload.timeoutMs ?? 2_000,
      },
      timeoutMs: Math.max((payload.timeoutMs ?? 2_000) + 5_000, 7_000),
    });

    if (
      !result.connected &&
      typeof result.message === "string" &&
      result.message.includes("status=515")
    ) {
      result.message =
        `${result.message} ` +
        "WhatsApp sometimes requests a restart right after scanning. Keep this page open for ~15s and it should recover. " +
        "If it keeps looping, click “Force relink” to generate a fresh QR.";
    }

    return { ok: true, result };
  },
);

app.post(
  "/me/whatsapp/test-send",
  { preHandler: [(app as any).authenticate] },
  async (request: any, reply: any) => {
    const userId = request.user?.sub as string | undefined;
    if (!userId) {
      reply.code(401);
      return { ok: false, error: "unauthorized" };
    }
    const schema = z.object({
      to: z.string().optional(),
      message: z.string().min(1).max(2000).optional(),
      accountId: z.string().optional(),
    });
    const payload = schema.parse(request.body ?? {});

    const user = await resolveInstanceForUser(userId, {
      accountId: payload.accountId,
    });
    if (!user) {
      reply.code(404);
      return { ok: false, error: "user_not_found" };
    }

    const to = payload.to ?? user.phone;
    if (!to) {
      reply.code(400);
      return { ok: false, error: "missing_to" };
    }

    const message =
      payload.message ??
      `✅ WhatsApp is paired. (${new Date().toISOString()}) Reply “ping” and I’ll answer.`;
    try {
      await sendViaOpenclaw({
        instanceEndpoint: user.instanceEndpoint ?? defaultInstanceEndpoint,
        accountId: user.accountId,
        to,
        message,
      });
      return { ok: true };
    } catch (error) {
      reply.code(502);
      return { ok: false, error: String(error) };
    }
  },
);

app.get(
  "/me/whatsapp/status",
  { preHandler: [(app as any).authenticate] },
  async (_request: any, reply: any) => {
    if (!openclawGatewayUrl) {
      reply.code(500);
      return { error: "openclaw_gateway_not_configured" };
    }

    const payload = await callOpenclawGateway<{
      channelAccounts: Record<string, Array<Record<string, unknown>>>;
      channelDefaultAccountId: Record<string, string>;
      ts: number;
    }>({
      url: openclawGatewayUrl,
      token: openclawGatewayToken || undefined,
      method: "channels.status",
      params: { probe: false, timeoutMs: 5_000 },
      timeoutMs: 10_000,
    });

    const accounts = payload.channelAccounts?.whatsapp ?? [];
    const resolvedDefaultAccountId =
      payload.channelDefaultAccountId?.whatsapp ?? defaultAccountId;
    const account =
      accounts.find((a) => a.accountId === resolvedDefaultAccountId) ??
      accounts[0] ??
      null;

    const linkedAsE164 = await readWhatsAppLinkedE164(resolvedDefaultAccountId);
    return {
      ok: true,
      ts: payload.ts,
      defaultAccountId: resolvedDefaultAccountId,
      linkedAsE164,
      account,
    };
  },
);

app.get(
  "/me/nodes/status",
  { preHandler: [(app as any).authenticate] },
  async (_request: any, reply: any) => {
    if (!openclawGatewayUrl) {
      reply.code(500);
      return { ok: false, error: "openclaw_gateway_not_configured" };
    }

    const [nodes, pairing] = await Promise.all([
      callOpenclawGateway<Record<string, unknown>>({
        url: openclawGatewayUrl,
        token: openclawGatewayToken || undefined,
        method: "node.list",
        params: {},
        timeoutMs: 10_000,
      }),
      callOpenclawGateway<Record<string, unknown>>({
        url: openclawGatewayUrl,
        token: openclawGatewayToken || undefined,
        method: "node.pair.list",
        params: {},
        timeoutMs: 10_000,
      }),
    ]);

    // This command runs on the developer's machine (not in Docker). It connects a "node host"
    // to the Gateway and enables browser automation from the user's residential IP.
    const gatewayHost = "127.0.0.1";
    const gatewayPort = 18789;
    const token = openclawGatewayToken || "dev-gateway-token";
    const stateDir = ".openclaw-local";
    const nodeHostCommand =
      `OPENCLAW_STATE_DIR=${stateDir} OPENCLAW_GATEWAY_TOKEN=${token} ` +
      `node packages/openclaw-fork/openclaw.mjs node run ` +
      `--host ${gatewayHost} --port ${gatewayPort} --display-name \"Local Browser Node\"`;

    return {
      ok: true,
      nodes,
      pairing,
      nodeHost: {
        gatewayHost,
        gatewayPort,
        token,
        stateDir,
        command: nodeHostCommand,
      },
    };
  },
);

app.post(
  "/me/nodes/approve",
  { preHandler: [(app as any).authenticate] },
  async (request: any, reply: any) => {
    if (!openclawGatewayUrl) {
      reply.code(500);
      return { ok: false, error: "openclaw_gateway_not_configured" };
    }
    const schema = z.object({ requestId: z.string().min(1) });
    const payload = schema.parse(request.body ?? {});
    const result = await callOpenclawGateway<Record<string, unknown>>({
      url: openclawGatewayUrl,
      token: openclawGatewayToken || undefined,
      method: "node.pair.approve",
      params: { requestId: payload.requestId },
      timeoutMs: 15_000,
    });
    return { ok: true, result };
  },
);

// Internal endpoint: approve all pending pairing requests (both device and node flows).
// Called from dev-up.sh after the local node host starts, so no manual UI interaction is needed.
// The node host uses the device.pair.* flow when it first connects; node.pair.* is a separate flow.
app.post("/internal/nodes/auto-pair", async (request, reply) => {
  if (!requireInternalAuth(request, reply)) {
    return;
  }
  if (!openclawGatewayUrl) {
    reply.code(503);
    return { ok: false, error: "openclaw_gateway_not_configured" };
  }

  // Fetch both device pairing requests (used by node hosts) and node pairing requests
  let devicePairing: Record<string, unknown> = {};
  let nodePairing: Record<string, unknown> = {};
  try {
    [devicePairing, nodePairing] = await Promise.all([
      callOpenclawGateway<Record<string, unknown>>({
        url: openclawGatewayUrl,
        token: openclawGatewayToken || undefined,
        method: "device.pair.list",
        params: {},
        timeoutMs: 10_000,
      }).catch(() => ({})),
      callOpenclawGateway<Record<string, unknown>>({
        url: openclawGatewayUrl,
        token: openclawGatewayToken || undefined,
        method: "node.pair.list",
        params: {},
        timeoutMs: 10_000,
      }).catch(() => ({})),
    ]);
  } catch (err) {
    reply.code(503);
    return { ok: false, error: "gateway_unavailable", detail: String(err) };
  }

  // device.pair.list returns { pending: [...], paired: [...] }
  const deviceRequests = Array.isArray(devicePairing?.pending)
    ? (devicePairing.pending as Array<{ requestId?: string; displayName?: string; role?: string }>)
    : [];

  // node.pair.list returns { requests: [...] }
  const nodeRequests = Array.isArray(nodePairing?.requests)
    ? (nodePairing.requests as Array<{ requestId?: string; displayName?: string }>)
    : [];

  const allPending = [
    ...deviceRequests.map((r) => ({ ...r, flow: "device" })),
    ...nodeRequests.map((r) => ({ ...r, flow: "node" })),
  ];

  if (allPending.length === 0) {
    return { ok: true, approved: 0, message: "no_pending_requests" };
  }

  const approved: string[] = [];
  const failed: string[] = [];

  for (const req of allPending) {
    const requestId = req.requestId;
    if (!requestId) continue;
    const method = req.flow === "device" ? "device.pair.approve" : "node.pair.approve";
    try {
      await callOpenclawGateway({
        url: openclawGatewayUrl,
        token: openclawGatewayToken || undefined,
        method,
        params: { requestId },
        timeoutMs: 10_000,
      });
      approved.push(requestId);
      app.log.info({ requestId, displayName: req.displayName, flow: req.flow }, "pairing auto-approved");
    } catch (err) {
      failed.push(requestId);
      app.log.warn({ requestId, err: String(err), flow: req.flow }, "pairing auto-approve failed");
    }
  }

  return { ok: true, approved: approved.length, approvedIds: approved, failedIds: failed };
});

app.post("/internal/openclaw/provision-agent", async (request, reply) => {
  if (!requireInternalAuth(request, reply)) {
    return;
  }
  const schema = z.object({
    userId: z.string().uuid(),
    phone: z.string().min(1),
    personaName: z.string().min(1),
    personaFiles: z.object({
      soul: z.string(),
      agents: z.string(),
      user: z.string(),
    }),
  });
  const payload = schema.parse(request.body);

  const agentId = payload.userId;
  const phone = normalizeE164Loose(payload.phone);
  if (!phone) {
    reply.code(400);
    return { ok: false, error: "invalid_phone" };
  }

  // 1) Update OpenClaw config (agents.list + bindings) and tighten DM policy.
  await upsertOpenclawAgentBinding({
    agentId,
    personaName: payload.personaName,
    phone,
    accountId: defaultAccountId,
  });

  // 2) Allowlist this phone for WhatsApp inbound (dmPolicy=allowlist).
  await upsertWhatsAppAllowFrom({ accountId: defaultAccountId, phone });

  // 3) Write persona files into the agent's workspace dir.
  await writePersonaFilesForAgent(agentId, payload.personaFiles);

  // 4) Ensure Anthropic key is available for this agent, if configured on the platform.
  const key = getAnthropicApiKey();
  if (key) {
    await writeAnthropicAuthProfile(key, agentId).catch(() => {});
  }

  return { ok: true };
});

app.post("/internal/provision", async (request, reply) => {
  if (!requireInternalAuth(request, reply)) {
    return;
  }
  const schema = z.object({
    userId: z.string(),
    phone: z.string().optional(),
    status: z.enum(["provisioned", "failed"]),
    instanceEndpoint: z.string().optional(),
    personaName: z.string().optional()
  });
  const payload = schema.parse(request.body);

  if (payload.status === "provisioned") {
    const update: Record<string, unknown> = { provisionedAt: new Date() };
    if (payload.phone) update.phone = payload.phone;
    if (payload.instanceEndpoint) update.instanceEndpoint = payload.instanceEndpoint;
    if (payload.personaName) update.personaName = payload.personaName;
    await db
      .update(users)
      .set(update as any)
      .where(eq(users.id, payload.userId));
  }

  app.log.info({ payload }, "provision callback received");
  return { ok: true };
});

app.post("/internal/message/send", async (request, reply) => {
  // Internal-only: OpenClaw + workers use this to send WhatsApp messages out.
  // Auth is optional in dev when PLATFORM_INTERNAL_TOKEN is unset.
  if (!requireInternalAuth(request, reply)) {
    return;
  }
  const schema = z.object({
    userId: z.string(),
    to: z.string().optional(),
    message: z.string(),
    instanceEndpoint: z.string().optional(),
    accountId: z.string().optional()
  });
  const payload = schema.parse(request.body);

  const user = await resolveInstanceForUser(payload.userId, {
    instanceEndpoint: payload.instanceEndpoint,
    accountId: payload.accountId
  });
  if (!user) {
    app.log.warn({ payload }, "outbound whatsapp missing user mapping");
    return { ok: false, error: "user_not_found" };
  }
  const to = payload.to ?? user.phone;
  if (!to) {
    app.log.warn({ payload }, "outbound whatsapp missing recipient");
    return { ok: false, error: "missing_to" };
  }
  try {
    await sendViaOpenclaw({
      instanceEndpoint: user.instanceEndpoint,
      accountId: user.accountId,
      to,
      message: payload.message
    });
    app.log.info({ payload }, "outbound whatsapp sent");
    return { ok: true };
  } catch (error) {
    app.log.warn({ payload, error: String(error) }, "outbound whatsapp failed");
    return { ok: false, error: "send_failed" };
  }
});

function resolveInboundUrl(base: string, pathValue: string): string {
  const trimmedBase = base.trim().replace(/\/$/, "");
  const normalizedPath = pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
  if (trimmedBase.includes(normalizedPath)) {
    return trimmedBase;
  }
  return `${trimmedBase}${normalizedPath}`;
}

const port = Number.parseInt(process.env.PORT || "3000", 10);

app.listen({ port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error, "api failed to start");
  process.exit(1);
});
