import { randomUUID } from "node:crypto";
import WebSocket, { type RawData } from "ws";

type GatewayResFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string; details?: unknown; retryable?: boolean };
};

type GatewayEventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
};

type GatewayFrame = GatewayResFrame | GatewayEventFrame | { type: "req"; id: string };

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export async function callOpenclawGateway<T>(opts: {
  url: string;
  token?: string;
  method: string;
  params?: unknown;
  timeoutMs?: number;
}): Promise<T> {
  const timeoutMs = Math.max(opts.timeoutMs ?? 15_000, 1000);
  const url = opts.url.trim();
  if (!url) {
    throw new Error("openclaw_gateway_url_missing");
  }

  return withTimeout(
    new Promise<T>((resolve, reject) => {
      // We connect as the Control UI client in dev so we can request the minimal
      // scope needed for `web.login.*` methods (operator.admin) without device pairing.
      // The OpenClaw dev config explicitly opts into this bypass.
      const ws = new WebSocket(url, {
        headers: {
          Origin: "http://openclaw:18789",
        },
      });
      let finished = false;
      const pending = new Map<
        string,
        { resolve: (frame: GatewayResFrame) => void; reject: (err: Error) => void }
      >();

      const cleanup = (err?: unknown) => {
        if (finished) return;
        finished = true;
        for (const [, waiter] of pending) {
          waiter.reject(err instanceof Error ? err : new Error(String(err ?? "ws_closed")));
        }
        pending.clear();
        try {
          ws.close();
        } catch {
          // ignore
        }
      };

      const sendReq = (method: string, params?: unknown) => {
        const id = randomUUID();
        const payload = { type: "req", id, method, ...(params === undefined ? {} : { params }) };
        const p = new Promise<GatewayResFrame>((res, rej) => pending.set(id, { resolve: res, reject: rej }));
        ws.send(JSON.stringify(payload));
        return p;
      };

      ws.on("open", async () => {
        try {
          const connect = await sendReq("connect", {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: "openclaw-control-ui",
              displayName: "concierge-api",
              version: "0.1.0",
              platform: "concierge-platform",
              mode: "ui",
            },
            role: "operator",
            scopes: ["operator.admin"],
            ...(opts.token ? { auth: { token: opts.token } } : {}),
          });

          if (!connect.ok) {
            const message = connect.error?.message || "openclaw_gateway_connect_failed";
            cleanup(message);
            reject(new Error(message));
            return;
          }

          const res = await sendReq(opts.method, opts.params);
          if (!res.ok) {
            const message = res.error?.message || "openclaw_gateway_request_failed";
            cleanup(message);
            reject(new Error(message));
            return;
          }
          cleanup();
          resolve(res.payload as T);
        } catch (err) {
          cleanup(err);
          reject(err as Error);
        }
      });

      ws.on("message", (data: RawData) => {
        let parsed: GatewayFrame | null = null;
        try {
          parsed = JSON.parse(String(data)) as GatewayFrame;
        } catch {
          return;
        }
        if (!parsed || typeof parsed !== "object") return;
        if (parsed.type === "res" && typeof parsed.id === "string") {
          const waiter = pending.get(parsed.id);
          if (!waiter) return;
          pending.delete(parsed.id);
          waiter.resolve(parsed);
          return;
        }
        // Ignore events/unknown frames for this request-response helper.
      });

      ws.on("error", (err: Error) => {
        cleanup(err);
        reject(err as Error);
      });

      ws.on("close", () => {
        cleanup(new Error("openclaw_gateway_closed"));
      });
    }),
    timeoutMs,
    "openclaw_gateway_timeout",
  );
}
