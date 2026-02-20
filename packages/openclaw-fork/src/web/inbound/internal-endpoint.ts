import { createServer, type Server } from "node:http";
import type { AnyMessageContent } from "@whiskeysockets/baileys";
import { isJidGroup } from "@whiskeysockets/baileys";
import { recordChannelActivity } from "../../infra/channel-activity.js";
import {
  readJsonBodyWithLimit,
  requestBodyErrorToText,
  type ReadJsonBodyResult,
} from "../../infra/http-body.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { getActiveWebListener } from "../active-listener.js";
import type { WebInboundMessage } from "./types.js";

const INTERNAL_MAX_BODY_BYTES = 256 * 1024;
const INTERNAL_BODY_TIMEOUT_MS = 10_000;

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

function sendJson(res: { writeHead: (code: number) => void; end: (body?: string) => void }, code: number, body: string) {
  res.writeHead(code);
  res.end(body);
}

export async function startInternalWebInboundServer(opts: {
  port: number;
  host?: string;
  path?: string;
  token?: string;
  accountId: string;
  getHandler: () => ((msg: WebInboundMessage) => Promise<void>) | null;
}): Promise<InternalWebInboundServer> {
  const logger = createSubsystemLogger("gateway/channels/whatsapp/internal");
  const host = opts.host ?? "127.0.0.1";
  const path = opts.path ?? "/internal/whatsapp/inbound";
  const token = opts.token?.trim();

  const server = createServer(async (req, res) => {
    if (req.url !== path || req.method !== "POST") {
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

    const handler = opts.getHandler();
    if (!handler) {
      sendJson(res, 503, "no_handler");
      return;
    }

    const listener = getActiveWebListener(accountId);
    if (!listener) {
      sendJson(res, 503, "no_active_listener");
      return;
    }

    const chatType = resolveChatType(payload as InternalWebInboundPayload);
    const chatId = payload.chatId ?? payload.conversationId ?? payload.from;
    const conversationId = payload.conversationId ?? payload.from;
    const senderE164 = payload.senderE164 ?? (chatType === "direct" ? payload.from : undefined);

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
        await listener.sendComposingTo(chatId);
      },
      reply: async (text: string) => {
        await listener.sendMessage(chatId, text, undefined, undefined, { accountId });
      },
      sendMedia: async (payload: AnyMessageContent) => {
        await sendMediaPayload({ chatId, accountId, payload }, listener.sendMessage);
      },
    };

    recordChannelActivity({ channel: "whatsapp", accountId, direction: "inbound" });

    try {
      await handler(inboundMessage);
      sendJson(res, 200, "ok");
    } catch (error) {
      logger.warn({ error: String(error) }, "failed to process internal inbound message");
      sendJson(res, 500, "handler_error");
    }
  });

  await new Promise<void>((resolve) => server.listen(opts.port, host, resolve));
  logger.info(`Internal WhatsApp inbound server listening on http://${host}:${opts.port}${path}`);

  return {
    server,
    stop: () => server.close(),
  };
}
