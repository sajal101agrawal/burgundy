import Fastify from "fastify";
import { logger } from "@concierge/logger";
import { randomUUID } from "node:crypto";
import { and, desc, eq, ilike } from "drizzle-orm";
import { getDb, memories, migrateDb } from "@concierge/db";

const app = Fastify({ logger: logger as any });

const db = getDb();

try {
  await migrateDb();
  app.log.info("db migrations up to date");
} catch (error) {
  app.log.error({ error: String(error) }, "db migration failed");
  process.exit(1);
}

app.post("/memory/add", async (request) => {
  const payload = request.body as { userId?: string; content?: string; metadata?: object };
  const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
  const content = typeof payload.content === "string" ? payload.content.trim() : "";
  if (!userId || !content) {
    return { ok: false, error: "userId_and_content_required" };
  }

  const id = randomUUID();
  await db.insert(memories).values({
    id,
    userId,
    content,
    metadata: payload.metadata ?? {},
    // Dev-grade: store an empty embedding. (The platform can upgrade this to pgvector later.)
    embedding: "[]",
    createdAt: new Date(),
  });
  return { ok: true, id };
});

app.post("/memory/query", async (request) => {
  const payload = request.body as { userId?: string; query?: string };
  const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
  const query = typeof payload.query === "string" ? payload.query.trim() : "";
  if (!userId) {
    return { ok: false, error: "userId_required" };
  }

  const where = query
    ? and(eq(memories.userId, userId), ilike(memories.content, `%${query}%`))
    : eq(memories.userId, userId);

  const rows = await db
    .select()
    .from(memories)
    .where(where)
    .orderBy(desc(memories.createdAt))
    .limit(5);

  const results = rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    content: row.content,
    metadata: row.metadata,
    createdAt: row.createdAt?.toISOString?.() ?? null,
  }));

  return { ok: true, results };
});

const port = Number.parseInt(process.env.PORT || "3003", 10);
app.listen({ port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error, "memory service failed to start");
  process.exit(1);
});
