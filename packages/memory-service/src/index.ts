import Fastify from "fastify";
import OpenAI from "openai";
import { logger } from "@concierge/logger";
import { randomUUID } from "node:crypto";
import { and, desc, eq, ilike } from "drizzle-orm";
import { getDb, getPool, memories, migrateDb } from "@concierge/db";

// biome-ignore lint/suspicious/noExplicitAny: pino logger shape is compatible at runtime
const app = Fastify({ logger: logger as any });
const db = getDb();

try {
  await migrateDb();
  app.log.info("db migrations up to date");
} catch (error) {
  app.log.error({ error: String(error) }, "db migration failed");
  process.exit(1);
}

// Ensure pgvector extension exists (best effort — requires pg superuser or pre-installed)
try {
  const pool = getPool();
  await pool!.query("CREATE EXTENSION IF NOT EXISTS vector");
  app.log.info("pgvector extension ready");
} catch (err) {
  app.log.warn({ err: String(err) }, "pgvector extension not available — vector search degraded to text search");
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

let openaiClient: OpenAI | null = null;
const getOpenAI = (): OpenAI | null => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  if (!openaiClient) openaiClient = new OpenAI({ apiKey });
  return openaiClient;
};

const generateEmbedding = async (text: string): Promise<number[] | null> => {
  const client = getOpenAI();
  if (!client) return null;
  try {
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8192),
      dimensions: EMBEDDING_DIMENSIONS,
    });
    return response.data[0]?.embedding ?? null;
  } catch (err) {
    app.log.warn({ err: String(err) }, "embedding generation failed");
    return null;
  }
};

// Serialise a float array to the format pgvector accepts: "[0.1,0.2,...]"
const serializeVector = (vec: number[]): string => `[${vec.join(",")}]`;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.post("/memory/add", async (request) => {
  const payload = request.body as { userId?: string; content?: string; metadata?: object };
  const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
  const content = typeof payload.content === "string" ? payload.content.trim() : "";
  if (!userId || !content) {
    return { ok: false, error: "userId_and_content_required" };
  }

  const embedding = await generateEmbedding(content);
  const id = randomUUID();

  await db.insert(memories).values({
    id,
    userId,
    content,
    metadata: payload.metadata ?? {},
    embedding: embedding ? serializeVector(embedding) : "[]",
    createdAt: new Date(),
  });

  return { ok: true, id };
});

app.post("/memory/query", async (request) => {
  const payload = request.body as { userId?: string; query?: string; limit?: number };
  const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
  const query = typeof payload.query === "string" ? payload.query.trim() : "";
  const limit = typeof payload.limit === "number" && payload.limit > 0 ? Math.min(payload.limit, 20) : 5;

  if (!userId) {
    return { ok: false, error: "userId_required" };
  }

  // Attempt vector similarity search if OpenAI is configured and query is provided
  if (query && getOpenAI()) {
    const queryEmbedding = await generateEmbedding(query);
    if (queryEmbedding) {
      try {
        const pool = getPool();
        const vectorStr = serializeVector(queryEmbedding);
        // Cast the text column to vector on the fly — works when pgvector is installed
        const result = await pool!.query<{
          id: string;
          user_id: string;
          content: string;
          metadata: unknown;
          created_at: Date;
          distance: number;
        }>(
          `SELECT id, user_id, content, metadata, created_at,
                  embedding::vector(${EMBEDDING_DIMENSIONS}) <=> $2::vector(${EMBEDDING_DIMENSIONS}) AS distance
           FROM memories
           WHERE user_id = $1 AND embedding <> '[]'
           ORDER BY distance ASC
           LIMIT $3`,
          [userId, vectorStr, limit],
        );

        return {
          ok: true,
          method: "vector",
          results: result.rows.map((row) => ({
            id: row.id,
            userId: row.user_id,
            content: row.content,
            metadata: row.metadata,
            createdAt: row.created_at?.toISOString?.() ?? null,
            score: row.distance !== undefined ? 1 - row.distance : undefined,
          })),
        };
      } catch (err) {
        // pgvector not available or cast failed — fall through to text search
        app.log.warn({ err: String(err) }, "vector search failed, falling back to text search");
      }
    }
  }

  // Fallback: text search (ILIKE) or fetch all recent
  const where = query
    ? and(eq(memories.userId, userId), ilike(memories.content, `%${query}%`))
    : eq(memories.userId, userId);

  const rows = await db
    .select()
    .from(memories)
    .where(where)
    .orderBy(desc(memories.createdAt))
    .limit(limit);

  return {
    ok: true,
    method: "text",
    results: rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      content: row.content,
      metadata: row.metadata,
      createdAt: row.createdAt?.toISOString?.() ?? null,
    })),
  };
});

const port = Number.parseInt(process.env.PORT || "3003", 10);
app.listen({ port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error, "memory service failed to start");
  process.exit(1);
});
