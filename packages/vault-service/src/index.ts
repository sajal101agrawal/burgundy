import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import Fastify from "fastify";
import { and, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { getDb, migrateDb, vaultEntries, vaultKeys, vaultShares } from "@concierge/db";
import { logger } from "@concierge/logger";
import type { VaultEntry } from "@concierge/types";

type VaultShare = {
  userId: string;
  permission: "view" | "use";
  expiresAt?: string | null;
};

type StoredVaultEntry = VaultEntry & {
  encryptedPassword?: string | null;
  notesEncrypted?: string | null;
};

type VaultEntryInput = StoredVaultEntry & {
  password?: string | null;
  notes?: string | null;
};

type DbVaultEntry = typeof vaultEntries.$inferSelect;

const toStoredEntry = (row: DbVaultEntry): StoredVaultEntry => ({
  ...row,
  createdBy: row.createdBy as VaultEntry["createdBy"],
  twoFaType: row.twoFaType as VaultEntry["twoFaType"],
  sharedWith: Array.isArray(row.sharedWith) ? (row.sharedWith as VaultShare[]) : [],
  lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  createdAt: row.createdAt ? row.createdAt.toISOString() : new Date().toISOString()
});

const app = Fastify({ logger: logger as any });
const db = getDb();

try {
  await migrateDb();
  app.log.info("db migrations up to date");
} catch (error) {
  app.log.error({ error: String(error) }, "db migration failed");
  process.exit(1);
}

const vaultKeyCache = new Map<string, Buffer>();

const ENC_PREFIX = "enc:v1";
const KEY_PREFIX = "kms:v1";

const loadMasterKey = (): Buffer => {
  const raw = process.env.VAULT_MASTER_KEY?.trim();
  if (!raw) {
    app.log.warn("VAULT_MASTER_KEY not set; using ephemeral key (dev only)");
    return randomBytes(32);
  }
  if (raw.startsWith("base64:")) {
    const buf = Buffer.from(raw.slice("base64:".length), "base64");
    if (buf.length === 32) return buf;
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length === 32) return buf;
  return createHash("sha256").update(raw).digest();
};

const masterKey = loadMasterKey();

const encryptWithKey = (key: Buffer, plaintext: string, aad: string, prefix: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${prefix}:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
};

const decryptWithKey = (key: Buffer, payload: string, aad: string, prefix: string): string => {
  if (!payload.startsWith(prefix)) {
    throw new Error("Unsupported ciphertext format");
  }
  const parts = payload.split(":");
  if (parts.length !== 5) {
    throw new Error("Invalid ciphertext format");
  }
  const iv = Buffer.from(parts[2] || "", "base64");
  const tag = Buffer.from(parts[3] || "", "base64");
  const encrypted = Buffer.from(parts[4] || "", "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
};

const getVaultKey = async (userId: string): Promise<Buffer> => {
  const cached = vaultKeyCache.get(userId);
  if (cached) return cached;

  const existingRows = await db
    .select({ encryptedKey: vaultKeys.encryptedKey })
    .from(vaultKeys)
    .where(eq(vaultKeys.userId, userId))
    .limit(1);
  const existing = existingRows[0];
  if (existing?.encryptedKey) {
    const decrypted = decryptWithKey(masterKey, existing.encryptedKey, `vault-key:${userId}`, KEY_PREFIX);
    const buf = Buffer.from(decrypted, "base64");
    if (buf.length !== 32) {
      throw new Error("Invalid vault key length");
    }
    vaultKeyCache.set(userId, buf);
    return buf;
  }

  const newKey = randomBytes(32);
  const encrypted = encryptWithKey(
    masterKey,
    newKey.toString("base64"),
    `vault-key:${userId}`,
    KEY_PREFIX,
  );

  const inserted = await db
    .insert(vaultKeys)
    .values({ userId, encryptedKey: encrypted, createdAt: new Date() })
    .onConflictDoNothing()
    .returning({ encryptedKey: vaultKeys.encryptedKey });

  if (inserted.length > 0) {
    vaultKeyCache.set(userId, newKey);
    return newKey;
  }

  const retryRows = await db
    .select({ encryptedKey: vaultKeys.encryptedKey })
    .from(vaultKeys)
    .where(eq(vaultKeys.userId, userId))
    .limit(1);
  const retry = retryRows[0];
  if (!retry?.encryptedKey) {
    throw new Error("Vault key persistence failed");
  }
  const decrypted = decryptWithKey(masterKey, retry.encryptedKey, `vault-key:${userId}`, KEY_PREFIX);
  const buf = Buffer.from(decrypted, "base64");
  if (buf.length !== 32) {
    throw new Error("Invalid vault key length");
  }
  vaultKeyCache.set(userId, buf);
  return buf;
};

const encryptField = async (userId: string, entryId: string, field: string, value: string) => {
  const key = await getVaultKey(userId);
  return encryptWithKey(key, value, `${userId}:${entryId}:${field}`, ENC_PREFIX);
};

const decryptField = async (userId: string, entryId: string, field: string, value: string) => {
  const key = await getVaultKey(userId);
  return decryptWithKey(key, value, `${userId}:${entryId}:${field}`, ENC_PREFIX);
};

const isShareValid = (share: VaultShare | undefined | null): boolean => {
  if (!share) return false;
  if (!share.expiresAt) return true;
  const expiresAt = Date.parse(share.expiresAt);
  if (Number.isNaN(expiresAt)) return false;
  return Date.now() <= expiresAt;
};

const resolveAccess = (
  entry: StoredVaultEntry,
  userId: string,
  share?: VaultShare | null,
): { level: "owner" | "view" | "use"; share?: VaultShare } | null => {
  if (entry.userId === userId) {
    return { level: "owner" };
  }
  if (!share || !isShareValid(share)) {
    return null;
  }
  return { level: share.permission === "use" ? "use" : "view", share };
};

const loadShareForUser = async (entryId: string, userId: string): Promise<VaultShare | null> => {
  const now = new Date();
  const rows = await db
    .select({
      userId: vaultShares.userId,
      permission: vaultShares.permission,
      expiresAt: vaultShares.expiresAt,
    })
    .from(vaultShares)
    .where(
      and(
        eq(vaultShares.vaultEntryId, entryId),
        eq(vaultShares.userId, userId),
        or(isNull(vaultShares.expiresAt), gte(vaultShares.expiresAt, now)),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.userId,
    permission: row.permission,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  };
};

const loadSharesForEntries = async (entryIds: string[]): Promise<Map<string, VaultShare[]>> => {
  const map = new Map<string, VaultShare[]>();
  if (entryIds.length === 0) return map;
  const rows = await db
    .select({
      vaultEntryId: vaultShares.vaultEntryId,
      userId: vaultShares.userId,
      permission: vaultShares.permission,
      expiresAt: vaultShares.expiresAt,
    })
    .from(vaultShares)
    .where(inArray(vaultShares.vaultEntryId, entryIds));
  for (const row of rows) {
    const list = map.get(row.vaultEntryId) ?? [];
    list.push({
      userId: row.userId,
      permission: row.permission,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    });
    map.set(row.vaultEntryId, list);
  }
  return map;
};

const sanitizeEntryForList = (entry: StoredVaultEntry): StoredVaultEntry => {
  const { encryptedPassword, notesEncrypted, ...rest } = entry;
  return { ...rest, encryptedPassword: null, notesEncrypted: null };
};

const buildEntryResponse = async (entry: StoredVaultEntry, access: "owner" | "view" | "use") => {
  if (access === "view") {
    return sanitizeEntryForList(entry);
  }
  const response: StoredVaultEntry & { password?: string; notes?: string } = { ...entry };
  if (entry.encryptedPassword) {
    try {
      response.password = await decryptField(entry.userId, entry.id, "password", entry.encryptedPassword);
    } catch (error) {
      app.log.warn({ error: String(error), entryId: entry.id }, "vault decrypt password failed");
    }
  }
  if (entry.notesEncrypted) {
    try {
      response.notes = await decryptField(entry.userId, entry.id, "notes", entry.notesEncrypted);
    } catch (error) {
      app.log.warn({ error: String(error), entryId: entry.id }, "vault decrypt notes failed");
    }
  }
  return response;
};

app.post("/vault/get", async (request) => {
  const { id, userId } = request.body as { id: string; userId?: string };
  if (!id || !userId) {
    return { found: false };
  }
  const rows = await db.select().from(vaultEntries).where(eq(vaultEntries.id, id)).limit(1);
  const entry = rows[0] ? toStoredEntry(rows[0]) : undefined;
  if (!entry) {
    return { found: false };
  }
  const share = entry.userId === userId ? null : await loadShareForUser(entry.id, userId);
  const access = resolveAccess(entry, userId, share);
  if (!access) {
    return { found: false };
  }
  const sharesMap = await loadSharesForEntries([entry.id]);
  const shares = sharesMap.get(entry.id) ?? [];
  entry.sharedWith = entry.userId === userId ? shares : share ? [share] : [];
  await db
    .update(vaultEntries)
    .set({ lastUsedAt: new Date() })
    .where(eq(vaultEntries.id, entry.id));
  const responseEntry = await buildEntryResponse(entry, access.level);
  return { found: true, entry: responseEntry };
});

app.post("/vault/set", async (request) => {
  const input = request.body as VaultEntryInput;
  if (!input?.id || !input?.userId) {
    return { ok: false, error: "id and userId required" };
  }

  const nowIso = new Date().toISOString();
  const hasSharedWith = Object.prototype.hasOwnProperty.call(input, "sharedWith");
  const sharedWith: VaultShare[] =
    hasSharedWith && Array.isArray(input.sharedWith)
      ? input.sharedWith.filter((share): share is VaultShare => Boolean(share?.userId))
      : [];
  const entry: StoredVaultEntry = {
    ...input,
    service: input.service || "unknown",
    label: input.label || input.service || "unknown",
    createdBy: input.createdBy || "agent",
    createdAt: input.createdAt || nowIso,
    lastUsedAt: input.lastUsedAt || nowIso,
    sharedWith,
  };
  const password = typeof input.password === "string" ? input.password : null;
  const notes = typeof input.notes === "string" ? input.notes : null;

  if (password) {
    entry.encryptedPassword = await encryptField(entry.userId, entry.id, "password", password);
  } else if (entry.encryptedPassword && !entry.encryptedPassword.startsWith(ENC_PREFIX)) {
    entry.encryptedPassword = await encryptField(
      entry.userId,
      entry.id,
      "password",
      entry.encryptedPassword,
    );
  }

  if (notes) {
    entry.notesEncrypted = await encryptField(entry.userId, entry.id, "notes", notes);
  } else if (entry.notesEncrypted && !entry.notesEncrypted.startsWith(ENC_PREFIX)) {
    entry.notesEncrypted = await encryptField(entry.userId, entry.id, "notes", entry.notesEncrypted);
  }

  delete (entry as { password?: string }).password;
  delete (entry as { notes?: string }).notes;

  const createdAt = entry.createdAt ? new Date(entry.createdAt) : new Date();
  const lastUsedAt = entry.lastUsedAt ? new Date(entry.lastUsedAt) : new Date();

  await db
    .insert(vaultEntries)
    .values({
      id: entry.id,
      userId: entry.userId,
      service: entry.service,
      label: entry.label,
      email: entry.email ?? null,
      username: entry.username ?? null,
      encryptedPassword: entry.encryptedPassword ?? null,
      twoFaType: entry.twoFaType ?? null,
      notesEncrypted: entry.notesEncrypted ?? null,
      createdBy: entry.createdBy,
      sharedWith: entry.sharedWith ?? [],
      lastUsedAt,
      createdAt,
    })
    .onConflictDoUpdate({
      target: vaultEntries.id,
      set: {
        service: entry.service,
        label: entry.label,
        email: entry.email ?? null,
        username: entry.username ?? null,
        encryptedPassword: entry.encryptedPassword ?? null,
        twoFaType: entry.twoFaType ?? null,
        notesEncrypted: entry.notesEncrypted ?? null,
        createdBy: entry.createdBy,
        lastUsedAt: new Date(),
        ...(hasSharedWith ? { sharedWith: entry.sharedWith ?? [] } : {}),
      },
    });

  if (hasSharedWith) {
    await db.delete(vaultShares).where(eq(vaultShares.vaultEntryId, entry.id));
    const shareValues: Array<typeof vaultShares.$inferInsert> = sharedWith.map((share) => ({
      id: randomUUID(),
      vaultEntryId: entry.id,
      userId: share.userId,
      permission: share.permission === "use" ? "use" : "view",
      expiresAt: share.expiresAt ? new Date(share.expiresAt) : null,
    }));
    if (shareValues.length > 0) {
      await db.insert(vaultShares).values(shareValues);
    }
  }

  return { ok: true };
});

app.post("/vault/list", async (request) => {
  const { userId } = request.body as { userId: string };
  if (!userId) {
    return { entries: [] };
  }

  const owned = await db.select().from(vaultEntries).where(eq(vaultEntries.userId, userId));
  const shareRows = await db
    .select({
      vaultEntryId: vaultShares.vaultEntryId,
      userId: vaultShares.userId,
      permission: vaultShares.permission,
      expiresAt: vaultShares.expiresAt,
    })
    .from(vaultShares)
    .where(
      and(
        eq(vaultShares.userId, userId),
        or(isNull(vaultShares.expiresAt), gte(vaultShares.expiresAt, new Date())),
      ),
    );

  const sharedEntryIds = shareRows.map((row) => row.vaultEntryId);
  const sharedEntries =
    sharedEntryIds.length > 0
      ? await db.select().from(vaultEntries).where(inArray(vaultEntries.id, sharedEntryIds))
      : [];

  const merged = new Map<string, StoredVaultEntry>();
  for (const entry of [...owned, ...sharedEntries]) {
    merged.set(entry.id, toStoredEntry(entry));
  }

  const entryIds = Array.from(merged.keys());
  const sharesMap = await loadSharesForEntries(entryIds);

  const entries = Array.from(merged.values()).flatMap((entry) => {
    const share = entry.userId === userId ? null : shareRows.find((row) => row.vaultEntryId === entry.id);
    const access = resolveAccess(
      entry,
      userId,
      share
        ? {
            userId: share.userId,
            permission: share.permission,
            expiresAt: share.expiresAt ? share.expiresAt.toISOString() : null,
          }
        : null,
    );
    if (!access) return [];
    const shares = sharesMap.get(entry.id) ?? [];
    entry.sharedWith = entry.userId === userId ? shares : access.share ? [access.share] : [];
    return [sanitizeEntryForList(entry)];
  });

  return { entries };
});

const port = Number.parseInt(process.env.PORT || "3002", 10);
app.listen({ port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error, "vault service failed to start");
  process.exit(1);
});
