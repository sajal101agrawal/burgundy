import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const VaultGetSchema = Type.Object({
  id: Type.String({ description: "Vault entry id." }),
  userId: Type.Optional(Type.String({ description: "Optional user id override." })),
});

const VaultListSchema = Type.Object({
  userId: Type.Optional(Type.String({ description: "User id to list entries for." })),
});

const VaultSetSchema = Type.Object({
  entry: Type.Optional(
    Type.Object(
      {
        id: Type.Optional(Type.String()),
        userId: Type.Optional(Type.String()),
        service: Type.Optional(Type.String()),
        label: Type.Optional(Type.String()),
        email: Type.Optional(Type.String()),
        username: Type.Optional(Type.String()),
        encryptedPassword: Type.Optional(Type.String()),
        twoFaType: Type.Optional(Type.Union([Type.Literal("email"), Type.Literal("sms"), Type.Literal("app"), Type.Null()])),
        notesEncrypted: Type.Optional(Type.String()),
        createdBy: Type.Optional(Type.Union([Type.Literal("agent"), Type.Literal("user")])),
        sharedWith: Type.Optional(
          Type.Array(
            Type.Object({
              userId: Type.String(),
              permission: Type.Union([Type.Literal("view"), Type.Literal("use")]),
              expiresAt: Type.Optional(Type.String()),
            }),
          ),
        ),
        lastUsedAt: Type.Optional(Type.String()),
        createdAt: Type.Optional(Type.String()),
      },
      { additionalProperties: true },
    ),
  ),
  userId: Type.Optional(Type.String({ description: "User id override." })),
  id: Type.Optional(Type.String({ description: "Entry id override." })),
  service: Type.Optional(Type.String({ description: "Service/site name." })),
  label: Type.Optional(Type.String({ description: "Human-friendly label." })),
  email: Type.Optional(Type.String({ description: "Login email." })),
  username: Type.Optional(Type.String({ description: "Login username." })),
  password: Type.Optional(Type.String({ description: "Plaintext password (stored as encryptedPassword for now)." })),
  notes: Type.Optional(Type.String({ description: "Notes or recovery codes (stored as notesEncrypted for now)." })),
  createdBy: Type.Optional(Type.Union([Type.Literal("agent"), Type.Literal("user")])),
  twoFaType: Type.Optional(Type.Union([Type.Literal("email"), Type.Literal("sms"), Type.Literal("app")])),
});

const VaultShareSchema = Type.Object({
  id: Type.String({ description: "Vault entry id." }),
  userId: Type.Optional(Type.String({ description: "Optional user id override." })),
  targetUserId: Type.String({ description: "User id to share with." }),
  permission: Type.Union([Type.Literal("view"), Type.Literal("use")]),
  expiresAt: Type.Optional(Type.String({ description: "Optional ISO timestamp expiry." })),
});

type VaultEntryInput = Record<string, unknown>;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`vault request failed (${response.status}): ${text || response.statusText}`);
  }
  return (await response.json()) as T;
}

function resolveVaultUrl(): string {
  const baseUrl = process.env.VAULT_SERVICE_URL?.trim();
  if (!baseUrl) {
    throw new Error("VAULT_SERVICE_URL is not set");
  }
  return baseUrl;
}

function resolveUserId(input?: string): string {
  const userId = (typeof input === "string" && input.trim()) || process.env.PLATFORM_USER_ID?.trim();
  if (!userId) {
    throw new Error("userId required (set PLATFORM_USER_ID or pass userId)");
  }
  return userId;
}

function normalizeEntry(input: VaultEntryInput, fallbackUserId: string) {
  const now = new Date().toISOString();
  const entry: Record<string, unknown> = { ...input };
  entry.id = typeof entry.id === "string" && entry.id ? entry.id : randomUUID();
  entry.userId = typeof entry.userId === "string" && entry.userId ? entry.userId : fallbackUserId;
  entry.service = typeof entry.service === "string" ? entry.service : "";
  entry.label =
    typeof entry.label === "string" && entry.label
      ? entry.label
      : typeof entry.service === "string"
        ? entry.service
        : "";
  entry.createdBy = entry.createdBy === "user" ? "user" : "agent";
  entry.sharedWith = Array.isArray(entry.sharedWith) ? entry.sharedWith : [];
  entry.createdAt = typeof entry.createdAt === "string" ? entry.createdAt : now;
  entry.lastUsedAt = typeof entry.lastUsedAt === "string" ? entry.lastUsedAt : now;
  return entry;
}

export default {
  id: "vault-skill",
  name: "Vault Skill",
  description: "Manage encrypted credential entries via the vault service.",
  register(api: OpenClawPluginApi) {
    api.registerTool({
      name: "vault_get",
      label: "Vault Get",
      description: "Retrieve a vault entry by id.",
      parameters: VaultGetSchema,
      async execute(_toolCallId, params) {
        const id = typeof params.id === "string" ? params.id.trim() : "";
        if (!id) {
          throw new Error("id required");
        }
        const userId = resolveUserId(typeof (params as any).userId === "string" ? (params as any).userId : undefined);
        const baseUrl = resolveVaultUrl();
        const result = await postJson<{ found: boolean; entry?: unknown }>(`${baseUrl}/vault/get`, {
          id,
          userId,
        });
        return {
          content: [
            {
              type: "text",
              text: result.found ? JSON.stringify(result.entry, null, 2) : "Entry not found.",
            },
          ],
          details: result,
        };
      },
    });

    api.registerTool({
      name: "vault_list",
      label: "Vault List",
      description: "List vault entries for a user.",
      parameters: VaultListSchema,
      async execute(_toolCallId, params) {
        const userId = resolveUserId(typeof params.userId === "string" ? params.userId : undefined);
        const baseUrl = resolveVaultUrl();
        const result = await postJson<{ entries: unknown[] }>(`${baseUrl}/vault/list`, {
          userId,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.entries ?? [], null, 2),
            },
          ],
          details: result,
        };
      },
    });

    api.registerTool({
      name: "vault_set",
      label: "Vault Set",
      description: "Create or update a vault entry.",
      parameters: VaultSetSchema,
      async execute(_toolCallId, params) {
        const baseUrl = resolveVaultUrl();
        const userId = resolveUserId(typeof params.userId === "string" ? params.userId : undefined);

        const entryFromParams =
          params.entry && typeof params.entry === "object" ? (params.entry as VaultEntryInput) : {};

        const service =
          typeof params.service === "string" && params.service.trim() ? params.service.trim() : "";
        const label =
          typeof params.label === "string" && params.label.trim() ? params.label.trim() : service;

        const constructed: VaultEntryInput = {
          ...entryFromParams,
          id: typeof params.id === "string" ? params.id : entryFromParams.id,
          userId,
          service: entryFromParams.service ?? service,
          label: entryFromParams.label ?? label,
          email: entryFromParams.email ?? params.email,
          username: entryFromParams.username ?? params.username,
          encryptedPassword: entryFromParams.encryptedPassword,
          notesEncrypted: entryFromParams.notesEncrypted,
          twoFaType:
            entryFromParams.twoFaType ??
            (params.twoFaType === "email" || params.twoFaType === "sms" || params.twoFaType === "app"
              ? params.twoFaType
              : undefined),
          createdBy: entryFromParams.createdBy ?? params.createdBy,
        };

        if (typeof params.password === "string" && params.password.trim()) {
          constructed.password = params.password;
        }
        if (typeof params.notes === "string" && params.notes.trim()) {
          constructed.notes = params.notes;
        }

        const entry = normalizeEntry(constructed, userId);
        await postJson(`${baseUrl}/vault/set`, entry);
        return {
          content: [
            {
              type: "text",
              text: `Stored vault entry ${String(entry.id)}.`,
            },
          ],
          details: { entry },
        };
      },
    });

    api.registerTool({
      name: "vault_share",
      label: "Vault Share",
      description: "Share a vault entry with another user.",
      parameters: VaultShareSchema,
      async execute(_toolCallId, params) {
        const id = typeof params.id === "string" ? params.id.trim() : "";
        const targetUserId =
          typeof params.targetUserId === "string" ? params.targetUserId.trim() : "";
        if (!id || !targetUserId) {
          throw new Error("id and targetUserId required");
        }
        const baseUrl = resolveVaultUrl();
        const userId = resolveUserId(typeof (params as any).userId === "string" ? (params as any).userId : undefined);
        const getResult = await postJson<{ found: boolean; entry?: VaultEntryInput }>(
          `${baseUrl}/vault/get`,
          { id, userId },
        );
        if (!getResult.found || !getResult.entry) {
          throw new Error("vault entry not found");
        }

        const permission = params.permission === "use" ? "use" : "view";
        const expiresAt =
          typeof params.expiresAt === "string" && params.expiresAt.trim()
            ? params.expiresAt.trim()
            : undefined;

        const updated = { ...getResult.entry };
        const sharedWith = Array.isArray(updated.sharedWith) ? [...updated.sharedWith] : [];
        const filtered = sharedWith.filter(
          (share) => typeof share?.userId === "string" && share.userId !== targetUserId,
        );
        filtered.push({
          userId: targetUserId,
          permission,
          ...(expiresAt ? { expiresAt } : {}),
        });
        updated.sharedWith = filtered;

        await postJson(`${baseUrl}/vault/set`, updated);
        return {
          content: [
            {
              type: "text",
              text: `Shared vault entry ${id} with ${targetUserId}.`,
            },
          ],
          details: { entry: updated },
        };
      },
    });
  },
};
