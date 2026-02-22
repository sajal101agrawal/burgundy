import { createServer, type Server } from "node:http";
import type { AnyMessageContent } from "@whiskeysockets/baileys";
import { isJidGroup } from "@whiskeysockets/baileys";
import { getReplyFromConfig } from "../../auto-reply/reply.js";
import { DEFAULT_GROUP_HISTORY_LIMIT } from "../../auto-reply/reply/history.js";
import { loadConfig } from "../../config/config.js";
import { logVerbose } from "../../globals.js";
import { recordChannelActivity } from "../../infra/channel-activity.js";
import {
  readJsonBodyWithLimit,
  requestBodyErrorToText,
  type ReadJsonBodyResult,
} from "../../infra/http-body.js";
import { getChildLogger } from "../../logging.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { resolveWhatsAppAccount } from "../accounts.js";
import { getActiveWebListener } from "../active-listener.js";
import { DEFAULT_WEB_MEDIA_BYTES } from "../auto-reply/constants.js";
import { createEchoTracker } from "../auto-reply/monitor/echo.js";
import { createWebOnMessageHandler } from "../auto-reply/monitor/on-message.js";
import { buildMentionConfig } from "../auto-reply/mentions.js";
import { newConnectionId } from "../reconnect.js";
import type { WebInboundMessage } from "./types.js";

const INTERNAL_MAX_BODY_BYTES = 256 * 1024;
const INTERNAL_BODY_TIMEOUT_MS = 10_000;

type FallbackHandler = (msg: WebInboundMessage) => Promise<void>;
const fallbackHandlers = new Map<string, FallbackHandler>();

function resolveMaxMediaBytes(cfg: ReturnType<typeof loadConfig>): number {
  const configuredMaxMb = cfg.agents?.defaults?.mediaMaxMb;
  return typeof configuredMaxMb === "number" && configuredMaxMb > 0
    ? configuredMaxMb * 1024 * 1024
    : DEFAULT_WEB_MEDIA_BYTES;
}

function resolveGroupHistoryLimit(cfg: ReturnType<typeof loadConfig>, accountId: string): number {
  return (
    cfg.channels?.whatsapp?.accounts?.[accountId]?.historyLimit ??
    cfg.channels?.whatsapp?.historyLimit ??
    cfg.messages?.groupChat?.historyLimit ??
    DEFAULT_GROUP_HISTORY_LIMIT
  );
}

function resolveFallbackHandler(accountId: string): FallbackHandler {
  const cached = fallbackHandlers.get(accountId);
  if (cached) {
    return cached;
  }

  const cfg = loadConfig();
  const account = resolveWhatsAppAccount({ cfg, accountId });
  const connectionId = newConnectionId();
  const replyLogger = getChildLogger({ module: "web-auto-reply", runId: `internal-${connectionId}` });
  const handler = createWebOnMessageHandler({
    cfg,
    verbose: false,
    connectionId,
    maxMediaBytes: resolveMaxMediaBytes(cfg),
    groupHistoryLimit: resolveGroupHistoryLimit(cfg, account.accountId),
    groupHistories: new Map(),
    groupMemberNames: new Map(),
    echoTracker: createEchoTracker({ maxItems: 100, logVerbose }),
    backgroundTasks: new Set<Promise<unknown>>(),
    replyResolver: getReplyFromConfig,
    replyLogger,
    baseMentionConfig: buildMentionConfig(cfg),
    account,
  });

  fallbackHandlers.set(account.accountId, handler);
  return handler;
}

export type InternalWebInboundPayload = {
  from: string;
  body: string;
  accountId?: string;
  to?: string;
  classification?: string;
  chatType?: "direct" | "group";
  chatId?: string;
  conversationId?: string;
  senderJid?: string;
  senderE164?: string;
  senderName?: string;
  timestamp?: number;
  mentionedJids?: string[];
  groupSubject?: string;
  groupParticipants?: string[];
};

export type InternalWebOutboundPayload = {
  to: string;
  message: string;
  accountId?: string;
};

export type InternalWebInboundServer = {
  server: Server;
  stop: () => void;
};

function resolveChatType(payload: InternalWebInboundPayload): "direct" | "group" {
  if (payload.chatType === "group" || payload.chatType === "direct") {
    return payload.chatType;
  }
  const chatId = payload.chatId ?? payload.conversationId ?? payload.from;
  return isJidGroup(chatId) ? "group" : "direct";
}

function coerceBuffer(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  return null;
}

async function sendMediaPayload(
  params: {
    chatId: string;
    accountId: string;
    payload: AnyMessageContent;
  },
  sendMessage: (
    to: string,
    text: string,
    mediaBuffer?: Buffer,
    mediaType?: string,
    options?: { accountId?: string; fileName?: string },
  ) => Promise<{ messageId: string }>,
): Promise<void> {
  const payload = params.payload as AnyMessageContent & {
    image?: unknown;
    video?: unknown;
    audio?: unknown;
    document?: unknown;
    caption?: string;
    mimetype?: string;
    fileName?: string;
    text?: string;
  };

  if (typeof payload.text === "string") {
    await sendMessage(params.chatId, payload.text, undefined, undefined, {
      accountId: params.accountId,
    });
    return;
  }

  if (payload.image) {
    const buffer = coerceBuffer(payload.image);
    if (!buffer) {
      throw new Error("Unsupported image payload");
    }
    await sendMessage(params.chatId, payload.caption ?? "", buffer, payload.mimetype, {
      accountId: params.accountId,
    });
    return;
  }

  if (payload.video) {
    const buffer = coerceBuffer(payload.video);
    if (!buffer) {
      throw new Error("Unsupported video payload");
    }
    await sendMessage(params.chatId, payload.caption ?? "", buffer, payload.mimetype, {
      accountId: params.accountId,
    });
    return;
  }

  if (payload.audio) {
    const buffer = coerceBuffer(payload.audio);
    if (!buffer) {
      throw new Error("Unsupported audio payload");
    }
    await sendMessage(params.chatId, payload.caption ?? "", buffer, payload.mimetype, {
      accountId: params.accountId,
    });
    return;
  }

  if (payload.document) {
    const buffer = coerceBuffer(payload.document);
    if (!buffer) {
      throw new Error("Unsupported document payload");
    }
    await sendMessage(params.chatId, payload.caption ?? "", buffer, payload.mimetype, {
      accountId: params.accountId,
      fileName: payload.fileName,
    });
    return;
  }

  throw new Error("Unsupported media payload");
}

async function sendPlatformMessage(params: {
  apiUrl: string;
  token?: string;
  userId: string;
  to: string;
  message: string;
}): Promise<void> {
  const response = await fetch(`${params.apiUrl}/internal/message/send`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(params.token ? { authorization: `Bearer ${params.token}` } : {}),
    },
    body: JSON.stringify({
      userId: params.userId,
      to: params.to,
      message: params.message,
    }),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(
      `platform_send_failed:${response.status}${responseText ? `:${responseText}` : ""}`,
    );
  }
}

function sendJson(res: { writeHead: (code: number) => void; end: (body?: string) => void }, code: number, body: string) {
  res.writeHead(code);
  res.end(body);
}

export async function startInternalWebInboundServer(opts: {
  port: number;
  host?: string;
  path?: string;
  outboundPath?: string;
  token?: string;
  accountId: string;
  getHandler: () => ((msg: WebInboundMessage) => Promise<void>) | null;
}): Promise<InternalWebInboundServer> {
  const logger = createSubsystemLogger("gateway/channels/whatsapp/internal");
  const host = opts.host ?? "127.0.0.1";
  const inboundPath = opts.path ?? "/internal/whatsapp/inbound";
  const outboundPath = opts.outboundPath ?? "/internal/whatsapp/send";
  const token = opts.token?.trim();

  const server = createServer(async (req, res) => {
    const isInbound = req.url === inboundPath;
    const isOutbound = req.url === outboundPath;
    if ((!isInbound && !isOutbound) || req.method !== "POST") {
      res.writeHead(404);
      res.end();
      return;
    }

    if (token) {
      const auth = req.headers.authorization ?? "";
      if (auth !== `Bearer ${token}`) {
        sendJson(res, 401, "unauthorized");
        return;
      }
    }

    const bodyResult: ReadJsonBodyResult = await readJsonBodyWithLimit(req, {
      maxBytes: INTERNAL_MAX_BODY_BYTES,
      timeoutMs: INTERNAL_BODY_TIMEOUT_MS,
      emptyObjectOnEmpty: false,
    });

    if (!bodyResult.ok) {
      const status =
        bodyResult.code === "INVALID_JSON"
          ? 400
          : bodyResult.code === "REQUEST_BODY_TIMEOUT"
            ? 408
            : bodyResult.code === "CONNECTION_CLOSED"
              ? 400
              : 413;
      const message =
        bodyResult.code === "INVALID_JSON"
          ? "invalid_json"
          : requestBodyErrorToText(bodyResult.code);
      sendJson(res, status, message);
      return;
    }

    if (isOutbound) {
      const payload = bodyResult.value as Partial<InternalWebOutboundPayload>;
      if (!payload || typeof payload.to !== "string" || typeof payload.message !== "string") {
        sendJson(res, 400, "invalid_payload");
        return;
      }
      const accountId = payload.accountId ?? opts.accountId;
      if (payload.accountId && payload.accountId !== opts.accountId) {
        sendJson(res, 400, "account_mismatch");
        return;
      }
      const listener = getActiveWebListener(accountId);
      if (!listener) {
        sendJson(res, 503, "no_active_listener");
        return;
      }
      try {
        await listener.sendMessage(payload.to, payload.message, undefined, undefined, {
          accountId,
        });
        recordChannelActivity({ channel: "whatsapp", accountId, direction: "outbound" });
        sendJson(res, 200, "ok");
      } catch (error) {
        logger.warn("failed to send outbound message", { error: String(error) });
        sendJson(res, 500, "send_failed");
      }
      return;
    }

    const payload = bodyResult.value as Partial<InternalWebInboundPayload>;
    if (!payload || typeof payload.from !== "string" || typeof payload.body !== "string") {
      sendJson(res, 400, "invalid_payload");
      return;
    }

    const accountId = payload.accountId ?? opts.accountId;
    if (payload.accountId && payload.accountId !== opts.accountId) {
      sendJson(res, 400, "account_mismatch");
      return;
    }

    let handler = opts.getHandler();
    if (!handler) {
      try {
        handler = resolveFallbackHandler(accountId);
      } catch (error) {
        logger.warn("failed to resolve fallback handler", { error: String(error) });
      }
    }
    if (!handler) {
      sendJson(res, 503, "no_handler");
      return;
    }

    const listener = getActiveWebListener(accountId);
    const platformApi = process.env.PLATFORM_API_URL?.trim();
    const platformUserId = process.env.PLATFORM_USER_ID?.trim();
    const platformToken = process.env.PLATFORM_INTERNAL_TOKEN?.trim();
    if (!listener && (!platformApi || !platformUserId)) {
      sendJson(res, 503, "no_transport");
      return;
    }

    const chatType = resolveChatType(payload as InternalWebInboundPayload);
    const chatId = payload.chatId ?? payload.conversationId ?? payload.from;
    const conversationId = payload.conversationId ?? payload.from;
    const senderE164 = payload.senderE164 ?? (chatType === "direct" ? payload.from : undefined);

    const sendMessage = async (
      to: string,
      text: string,
      mediaBuffer?: Buffer,
      mediaType?: string,
      options?: { accountId?: string; fileName?: string },
    ): Promise<{ messageId: string }> => {
      if (listener) {
        return listener.sendMessage(to, text, mediaBuffer, mediaType, options);
      }
      if (mediaBuffer) {
        throw new Error("platform_media_not_supported");
      }
      if (!platformApi || !platformUserId) {
        throw new Error("platform_api_not_configured");
      }
      await sendPlatformMessage({
        apiUrl: platformApi,
        token: platformToken,
        userId: platformUserId,
        to,
        message: text,
      });
      return { messageId: "platform" };
    };

    const inboundMessage: WebInboundMessage = {
      id: undefined,
      from: payload.from,
      conversationId,
      to: payload.to ?? "me",
      accountId,
      body: payload.body,
      classification: payload.classification,
      pushName: payload.senderName,
      timestamp: payload.timestamp,
      chatType,
      chatId,
      senderJid: payload.senderJid,
      senderE164,
      senderName: payload.senderName,
      groupSubject: payload.groupSubject,
      groupParticipants: payload.groupParticipants,
      mentionedJids: payload.mentionedJids,
      selfJid: null,
      selfE164: payload.to ?? null,
      sendComposing: async () => {
        if (listener) {
          await listener.sendComposingTo(chatId);
        }
      },
      reply: async (text: string) => {
        await sendMessage(chatId, text, undefined, undefined, { accountId });
      },
      sendMedia: async (payload: AnyMessageContent) => {
        await sendMediaPayload({ chatId, accountId, payload }, sendMessage);
      },
    };

    recordChannelActivity({ channel: "whatsapp", accountId, direction: "inbound" });

    try {
      await handler(inboundMessage);
      sendJson(res, 200, "ok");
    } catch (error) {
      logger.warn("failed to process internal inbound message", { error: String(error) });
      sendJson(res, 500, "handler_error");
    }
  });

  await new Promise<void>((resolve) => server.listen(opts.port, host, resolve));
  logger.info(
    `Internal WhatsApp inbound server listening on http://${host}:${opts.port}${inboundPath}`,
  );
  logger.info(
    `Internal WhatsApp outbound server listening on http://${host}:${opts.port}${outboundPath}`,
  );

  return {
    server,
    stop: () => server.close(),
  };
}
