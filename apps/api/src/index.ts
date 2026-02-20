import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { z } from "zod";
import { getEnv } from "@concierge/config";
import { logger } from "@concierge/logger";
import { handleInbound, inMemoryRoutingContext } from "@concierge/routing-service";
import { classifyInterrupt } from "@concierge/interrupt-classifier";

const app = Fastify({ logger: logger as any });

await app.register(cors, { origin: true });
await app.register(jwt, { secret: getEnv("JWT_SECRET", "dev-secret") });

const defaultInstanceEndpoint =
  process.env.OPENCLAW_INTERNAL_BASE_URL || "http://openclaw:18800";
const defaultAccountId = process.env.WHATSAPP_ACCOUNT_ID || "default";
const internalToken = process.env.PLATFORM_INTERNAL_TOKEN?.trim();

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

const devUserPhone = process.env.DEV_USER_PHONE;
if (devUserPhone) {
  const devUserId = process.env.DEV_USER_ID || "dev-user";
  const devInstanceEndpoint = process.env.DEV_INSTANCE_ENDPOINT || defaultInstanceEndpoint;
  const devAccountId = process.env.DEV_WHATSAPP_ACCOUNT_ID || defaultAccountId;
  inMemoryRoutingContext.registerUser(devUserPhone, {
    userId: devUserId,
    instanceEndpoint: devInstanceEndpoint,
    accountId: devAccountId,
  });
  app.log.info(
    { devUserPhone, devUserId, devInstanceEndpoint, devAccountId },
    "registered dev user for routing",
  );
}

app.post("/webhook/whatsapp", async (request) => {
  const schema = z.object({
    from: z.string(),
    body: z.string().min(1)
  });
  const payload = schema.parse(request.body);

  const result = await handleInbound(payload, inMemoryRoutingContext);
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

  const userId = await inMemoryRoutingContext.lookupUserIdByPhone(payload.senderId);
  if (!userId) {
    return { handled: false };
  }
  const pending = await inMemoryRoutingContext.checkPendingListener(userId);
  if (!pending) {
    return { handled: false };
  }
  if (payload.body) {
    await inMemoryRoutingContext.resolvePendingListener(pending.id, payload.body);
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

  const userId = await inMemoryRoutingContext.lookupUserIdByPhone(payload.senderId);
  if (!userId) {
    return { classification: null };
  }
  const activeTask = await inMemoryRoutingContext.getActiveTask(userId);
  if (!activeTask) {
    return { classification: null };
  }
  const result = await classifyInterrupt({
    activeTaskGoal: activeTask.goal,
    newMessage: payload.body
  });
  return { classification: result.classification };
});

app.post("/auth/register", async (request) => {
  const schema = z.object({
    phone: z.string(),
    password: z.string().min(8),
    personaName: z.string().optional()
  });
  const payload = schema.parse(request.body);

  const userId = randomUUID();
  inMemoryRoutingContext.registerUser(payload.phone, {
    userId,
    instanceEndpoint: defaultInstanceEndpoint,
    accountId: defaultAccountId,
  });
  app.log.info(
    { phone: payload.phone, userId, instanceEndpoint: defaultInstanceEndpoint },
    "register stub queued",
  );
  return { status: "queued", userId, instanceEndpoint: defaultInstanceEndpoint };
});

app.post("/auth/login", async (request) => {
  const schema = z.object({
    phone: z.string(),
    password: z.string().min(8)
  });
  schema.parse(request.body);

  const token = app.jwt.sign({ sub: "user-id-placeholder" }, { expiresIn: "15m" });
  return { token };
});

app.get("/me/vault", { preHandler: [app.authenticate as any] }, async () => {
  return { entries: [] };
});

app.get("/me/tasks", { preHandler: [app.authenticate as any] }, async () => {
  return { tasks: [] };
});

app.get("/me/audit", { preHandler: [app.authenticate as any] }, async () => {
  return { events: [] };
});

app.post("/internal/provision", async (request) => {
  const schema = z.object({
    userId: z.string(),
    status: z.enum(["provisioned", "failed"]),
    instanceEndpoint: z.string().optional()
  });
  const payload = schema.parse(request.body);

  app.log.info({ payload }, "provision callback received");
  return { ok: true };
});

app.post("/internal/message/send", async (request) => {
  const schema = z.object({
    userId: z.string(),
    to: z.string(),
    message: z.string()
  });
  const payload = schema.parse(request.body);

  app.log.info({ payload }, "outbound whatsapp stub queued");
  return { ok: true };
});

const port = Number.parseInt(process.env.PORT || "3000", 10);

app.listen({ port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error, "api failed to start");
  process.exit(1);
});
