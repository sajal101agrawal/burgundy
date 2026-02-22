import { randomUUID } from "node:crypto";
import { logger } from "@concierge/logger";
import type { User } from "@concierge/types";
import { getDb, users } from "@concierge/db";
import { eq } from "drizzle-orm";
import { renderPersonaFiles, type PersonaFiles } from "./persona.js";

export interface ProvisionResult {
  user: User;
  workspacePath: string;
  personaFiles: PersonaFiles;
}

export const provisionUser = async (input: {
  userId?: string;
  phone: string;
  personaName: string;
  instanceEndpoint?: string;
}): Promise<ProvisionResult> => {
  const instanceEndpoint = input.instanceEndpoint || "http://openclaw:18810";
  const userId = input.userId || randomUUID();

  const platformEmail = `${input.personaName.toLowerCase().replace(/\s+/g, "-")}-${userId.slice(0, 6)}@platform.local`;
  // Deterministic dev phone: +1000 + last 8 digits of a hex hash.
  const platformPhone = `+1${parseInt(userId.replace(/-/g, "").slice(-8), 16).toString().padStart(10, "0").slice(0, 10)}`;

  const db = getDb();
  await db
    .update(users)
    .set({
      platformEmail,
      platformPhone,
      personaName: input.personaName,
      instanceEndpoint,
      provisionedAt: new Date(),
    })
    .where(eq(users.id, userId));

  const user: User = {
    id: userId,
    phone: input.phone,
    platformEmail,
    platformPhone,
    personaName: input.personaName,
    instanceEndpoint,
    provisionedAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };

  const personaFiles = renderPersonaFiles({ personaName: input.personaName });
  return { user, workspacePath: `/workspace/${user.id}`, personaFiles };
};
