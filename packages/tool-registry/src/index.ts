import { getDb, toolRegistry as toolRegistryTable } from "@concierge/db";
import type { ToolRegistryEntry } from "@concierge/types";
import { sql } from "drizzle-orm";

const db = getDb();

const toEntry = (row: typeof toolRegistryTable.$inferSelect): ToolRegistryEntry => ({
  toolId: row.toolId,
  name: row.name,
  category: Array.isArray(row.category) ? (row.category as string[]) : [],
  invocationType: row.invocationType as ToolRegistryEntry["invocationType"],
  config: (row.config ?? {}) as Record<string, unknown>,
  qualityScore: row.qualityScore ?? 0.5,
  fallbackTo: row.fallbackTo ?? null,
  lastValidated: row.lastValidated ? row.lastValidated.toISOString() : null,
});

export const seedRegistry = async (entries: ToolRegistryEntry[]) => {
  for (const entry of entries) {
    await upsertTool(entry);
  }
};

export const getToolByCategory = async (category: string): Promise<ToolRegistryEntry[]> => {
  const rows = await db
    .select()
    .from(toolRegistryTable)
    // category is a jsonb array; use @> to check containment.
    .where(sql`${toolRegistryTable.category} @> ${JSON.stringify([category])}::jsonb`);
  return rows.map(toEntry);
};

export const upsertTool = async (entry: ToolRegistryEntry) => {
  await db
    .insert(toolRegistryTable)
    .values({
      toolId: entry.toolId,
      name: entry.name,
      category: entry.category ?? [],
      invocationType: entry.invocationType,
      config: entry.config ?? {},
      qualityScore: entry.qualityScore ?? 0.5,
      fallbackTo: entry.fallbackTo ?? null,
      lastValidated: entry.lastValidated ? new Date(entry.lastValidated) : new Date(),
    })
    .onConflictDoUpdate({
      target: toolRegistryTable.toolId,
      set: {
        name: entry.name,
        category: entry.category ?? [],
        invocationType: entry.invocationType,
        config: entry.config ?? {},
        qualityScore: entry.qualityScore ?? 0.5,
        fallbackTo: entry.fallbackTo ?? null,
        lastValidated: entry.lastValidated ? new Date(entry.lastValidated) : new Date(),
      },
    });
};

