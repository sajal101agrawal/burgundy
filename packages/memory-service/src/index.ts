import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { logger } from "@concierge/logger";

const app = Fastify({ logger: logger as any });

const memories: Array<{ id: string; userId: string; content: string; metadata?: object }> = [];

app.post("/memory/add", async (request) => {
  const payload = request.body as { userId: string; content: string; metadata?: object };
  const entry = { id: randomUUID(), ...payload };
  memories.push(entry);
  return { id: entry.id };
});

app.post("/memory/query", async (request) => {
  const payload = request.body as { userId: string; query: string };
  const results = memories.filter((entry) => entry.userId === payload.userId).slice(0, 5);
  return { results };
});

const port = Number.parseInt(process.env.PORT || "3003", 10);
app.listen({ port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error, "memory service failed to start");
  process.exit(1);
});
