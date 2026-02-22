import { formatCliCommand } from "../cli/command-format.js";
import type { PollInput } from "../polls.js";
import { DEFAULT_ACCOUNT_ID } from "../routing/session-key.js";

export type ActiveWebSendOptions = {
  gifPlayback?: boolean;
  accountId?: string;
  fileName?: string;
};

export type ActiveWebListener = {
  sendMessage: (
    to: string,
    text: string,
    mediaBuffer?: Buffer,
    mediaType?: string,
    options?: ActiveWebSendOptions,
  ) => Promise<{ messageId: string }>;
  sendPoll: (to: string, poll: PollInput) => Promise<{ messageId: string }>;
  sendReaction: (
    chatJid: string,
    messageId: string,
    emoji: string,
    fromMe: boolean,
    participant?: string,
  ) => Promise<void>;
  sendComposingTo: (to: string) => Promise<void>;
  close?: () => Promise<void>;
};

// NOTE: OpenClaw is bundled into multiple chunks. In some deployments (including our
// Docker + internal HTTP ingress), the same module may be loaded more than once,
// which would otherwise create multiple independent `listeners` maps.
// Stash the singleton store on globalThis so internal endpoints and the WhatsApp
// monitor share the same in-memory registry.
type ActiveWebListenerStore = {
  listeners: Map<string, ActiveWebListener>;
  currentListener: ActiveWebListener | null;
};

const STORE_KEY = "__openclaw_active_web_listener_store__";
const store: ActiveWebListenerStore =
  ((globalThis as any)[STORE_KEY] as ActiveWebListenerStore | undefined) ??
  (((globalThis as any)[STORE_KEY] = {
    listeners: new Map<string, ActiveWebListener>(),
    currentListener: null,
  }) as ActiveWebListenerStore);

export function resolveWebAccountId(accountId?: string | null): string {
  return (accountId ?? "").trim() || DEFAULT_ACCOUNT_ID;
}

export function requireActiveWebListener(accountId?: string | null): {
  accountId: string;
  listener: ActiveWebListener;
} {
  const id = resolveWebAccountId(accountId);
  const listener = store.listeners.get(id) ?? null;
  if (!listener) {
    throw new Error(
      `No active WhatsApp Web listener (account: ${id}). Start the gateway, then link WhatsApp with: ${formatCliCommand(`openclaw channels login --channel whatsapp --account ${id}`)}.`,
    );
  }
  return { accountId: id, listener };
}

export function setActiveWebListener(listener: ActiveWebListener | null): void;
export function setActiveWebListener(
  accountId: string | null | undefined,
  listener: ActiveWebListener | null,
): void;
export function setActiveWebListener(
  accountIdOrListener: string | ActiveWebListener | null | undefined,
  maybeListener?: ActiveWebListener | null,
): void {
  const { accountId, listener } =
    typeof accountIdOrListener === "string"
      ? { accountId: accountIdOrListener, listener: maybeListener ?? null }
      : {
          accountId: DEFAULT_ACCOUNT_ID,
          listener: accountIdOrListener ?? null,
        };

  const id = resolveWebAccountId(accountId);
  if (!listener) {
    store.listeners.delete(id);
  } else {
    store.listeners.set(id, listener);
  }
  if (id === DEFAULT_ACCOUNT_ID) {
    store.currentListener = listener;
  }
}

export function getActiveWebListener(accountId?: string | null): ActiveWebListener | null {
  const id = resolveWebAccountId(accountId);
  return store.listeners.get(id) ?? null;
}
