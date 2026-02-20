export type TaskPhase =
  | "discuss"
  | "specify"
  | "confirm"
  | "execute"
  | "verify"
  | "deploy"
  | "deliver";

export type TaskStatus =
  | "pending"
  | "active"
  | "checkpointed"
  | "completed"
  | "failed"
  | "cancelled";

export type InterruptClassification =
  | "SUPERSEDE"
  | "MODIFY"
  | "ADDITIVE"
  | "UNRELATED";

export type ListenerType = "otp" | "confirm" | "choice" | "info";

export interface User {
  id: string;
  phone: string;
  platformEmail: string;
  platformPhone: string;
  personaName: string;
  instanceEndpoint: string;
  containerId?: string | null;
  provisionedAt?: string | null;
  createdAt: string;
}

export interface ExecutionStrategy {
  approach: "inline" | "cli" | "browser" | "api" | "hybrid";
  primaryTool: string;
  fallbackChain: string[];
  model: "sonnet" | "opus";
  phaseRequired: boolean;
}

export interface Task {
  id: string;
  userId: string;
  goal: string;
  status: TaskStatus;
  phase: TaskPhase;
  strategy?: ExecutionStrategy | null;
  checkpoint?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface VaultEntry {
  id: string;
  userId: string;
  service: string;
  label: string;
  email?: string | null;
  username?: string | null;
  encryptedPassword?: string | null;
  twoFaType?: "email" | "sms" | "app" | null;
  notesEncrypted?: string | null;
  createdBy: "agent" | "user";
  sharedWith: Array<{ userId: string; permission: "view" | "use"; expiresAt?: string | null }>;
  lastUsedAt?: string | null;
  createdAt: string;
}

export interface ToolRegistryEntry {
  toolId: string;
  name: string;
  category: string[];
  invocationType: "cli" | "browser" | "api" | "inline";
  config: Record<string, unknown>;
  qualityScore: number;
  fallbackTo?: string | null;
  lastValidated?: string | null;
}

export interface PendingListener {
  id: string;
  userId: string;
  taskId: string;
  type: ListenerType;
  messageSent: string;
  expiresAt: string;
  resolvedAt?: string | null;
}

export interface AuditLogEntry {
  id: string;
  userId: string;
  eventType: string;
  description: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}
