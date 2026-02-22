import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb } from "./client.js";

/**
 * Runtime migration helper for dev/test environments.
 *
 * In prod we’d typically run migrations as a separate job, but for local Docker
 * it’s much nicer if the API can self-boot.
 */
export async function migrateDb(opts?: { migrationsFolder?: string }) {
  const migrationsFolder =
    opts?.migrationsFolder ??
    path.join(process.cwd(), "packages", "shared", "db", "migrations");
  await migrate(getDb(), { migrationsFolder });
}

