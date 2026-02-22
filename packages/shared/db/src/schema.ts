import {
  boolean,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  doublePrecision
} from "drizzle-orm/pg-core";

export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "active",
  "checkpointed",
  "completed",
  "failed",
  "cancelled"
]);

export const taskPhaseEnum = pgEnum("task_phase", [
  "discuss",
  "specify",
  "confirm",
  "execute",
  "verify",
  "deploy",
  "deliver"
]);

export const listenerTypeEnum = pgEnum("listener_type", [
  "otp",
  "confirm",
  "choice",
  "info"
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().notNull(),
  phone: varchar("phone", { length: 32 }).unique().notNull(),
  passwordHash: text("password_hash").notNull(),
  platformEmail: varchar("platform_email", { length: 255 }),
  platformPhone: varchar("platform_phone", { length: 32 }),
  personaName: varchar("persona_name", { length: 64 }).notNull(),
  instanceEndpoint: varchar("instance_endpoint", { length: 512 }),
  containerId: varchar("container_id", { length: 128 }),
  provisionedAt: timestamp("provisioned_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull()
});

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().notNull(),
  userId: uuid("user_id").notNull(),
  goal: text("goal").notNull(),
  status: taskStatusEnum("status").notNull(),
  phase: taskPhaseEnum("phase").notNull(),
  strategy: jsonb("strategy"),
  checkpoint: jsonb("checkpoint"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true })
});

export const vaultEntries = pgTable("vault_entries", {
  id: uuid("id").primaryKey().notNull(),
  userId: uuid("user_id").notNull(),
  service: varchar("service", { length: 255 }).notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }),
  username: varchar("username", { length: 255 }),
  encryptedPassword: text("encrypted_password"),
  twoFaType: varchar("two_fa_type", { length: 32 }),
  notesEncrypted: text("notes_encrypted"),
  createdBy: varchar("created_by", { length: 16 }).notNull(),
  sharedWith: jsonb("shared_with").default([]).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull()
});

export const vaultKeys = pgTable("vault_keys", {
  userId: uuid("user_id").primaryKey().notNull(),
  encryptedKey: text("encrypted_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull()
});

export const memories = pgTable("memories", {
  id: uuid("id").primaryKey().notNull(),
  userId: uuid("user_id").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata"),
  embedding: text("embedding").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull()
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().notNull(),
  userId: uuid("user_id").notNull(),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  description: text("description").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull()
});

export const toolRegistry = pgTable("tool_registry", {
  toolId: varchar("tool_id", { length: 64 }).primaryKey().notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  category: jsonb("category").default([]).notNull(),
  invocationType: varchar("invocation_type", { length: 16 }).notNull(),
  config: jsonb("config").default({}).notNull(),
  qualityScore: doublePrecision("quality_score").default(0.5).notNull(),
  fallbackTo: varchar("fallback_to", { length: 64 }),
  lastValidated: timestamp("last_validated", { withTimezone: true })
});

export const pendingListeners = pgTable("pending_listeners", {
  id: uuid("id").primaryKey().notNull(),
  userId: uuid("user_id").notNull(),
  taskId: uuid("task_id").notNull(),
  type: listenerTypeEnum("type").notNull(),
  messageSent: text("message_sent").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true })
});

export const vaultSharePermissions = pgEnum("vault_share_permission", ["view", "use"]);

export const vaultShares = pgTable("vault_shares", {
  id: uuid("id").primaryKey().notNull(),
  vaultEntryId: uuid("vault_entry_id").notNull(),
  userId: uuid("user_id").notNull(),
  permission: vaultSharePermissions("permission").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true })
});

export const userSessions = pgTable("user_sessions", {
  id: uuid("id").primaryKey().notNull(),
  userId: uuid("user_id").notNull(),
  refreshTokenHash: text("refresh_token_hash").notNull(),
  revoked: boolean("revoked").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull()
});
