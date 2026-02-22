import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

let pool: Pool | null = null;
let dbInstance: ReturnType<typeof drizzle> | null = null;

export const getDb = () => {
  if (dbInstance) {
    return dbInstance;
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  pool = new Pool({ connectionString });
  dbInstance = drizzle(pool, { schema });
  return dbInstance;
};

export const getPool = () => {
  if (!pool) {
    getDb();
  }
  return pool;
};
