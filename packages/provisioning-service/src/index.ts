import { randomUUID } from "node:crypto";
import { logger } from "@concierge/logger";
import type { User } from "@concierge/types";
import { renderPersonaFiles, type PersonaFiles } from "./persona";

export interface ProvisionResult {
  user: User;
  workspacePath: string;
  personaFiles: PersonaFiles;
}

export const provisionUser = async (input: {
  phone: string;
  personaName: string;
}): Promise<ProvisionResult> => {
  logger.info({ phone: input.phone }, "provisioning user stub");

  const user: User = {
    id: randomUUID(),
    phone: input.phone,
    platformEmail: `${input.personaName.toLowerCase()}@platform.local`,
    platformPhone: "+10000000000",
    personaName: input.personaName,
    instanceEndpoint: "http://openclaw:18789",
    provisionedAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };

  const personaFiles = renderPersonaFiles({ personaName: input.personaName });
  return { user, workspacePath: `/workspace/${user.id}`, personaFiles };
};
