import Fastify from "fastify";
import { logger } from "@concierge/logger";
import type { VaultEntry } from "@concierge/types";

const app = Fastify({ logger: logger as any });

const store = new Map<string, VaultEntry>();

app.post("/vault/get", async (request) => {
  const { id } = request.body as { id: string };
  const entry = store.get(id);
  if (!entry) {
    return { found: false };
  }
  return { found: true, entry };
});

app.post("/vault/set", async (request) => {
  const entry = request.body as VaultEntry;
  store.set(entry.id, entry);
  return { ok: true };
});

app.post("/vault/list", async (request) => {
  const { userId } = request.body as { userId: string };
  const entries = Array.from(store.values()).filter((entry) => entry.userId === userId);
  return { entries };
});

const port = Number.parseInt(process.env.PORT || "3002", 10);
app.listen({ port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error, "vault service failed to start");
  process.exit(1);
});
