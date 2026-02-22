"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { apiFetch, clearToken, getToken, setToken } from "../lib/api";

export default function SettingsPage() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [token, setTokenState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [anthropicKey, setAnthropicKey] = useState("");
  const [anthropicConfigured, setAnthropicConfigured] = useState<boolean | null>(null);
  const [anthropicStatus, setAnthropicStatus] = useState<string | null>(null);
  const [waQrDataUrl, setWaQrDataUrl] = useState<string | null>(null);
  const [waConnected, setWaConnected] = useState<boolean | null>(null);
  const [waStatus, setWaStatus] = useState<string | null>(null);
  const [waBusy, setWaBusy] = useState(false);
  const [waAccount, setWaAccount] = useState<Record<string, unknown> | null>(null);
  const [waAccountId, setWaAccountId] = useState<string | null>(null);
  const [waStatusLoading, setWaStatusLoading] = useState(false);
  const [waLinkedAs, setWaLinkedAs] = useState<string | null>(null);
  const [waTestBusy, setWaTestBusy] = useState(false);
  const [waTestStatus, setWaTestStatus] = useState<string | null>(null);
  const [nodesStatus, setNodesStatus] = useState<Record<string, unknown> | null>(null);
  const [nodesPairing, setNodesPairing] = useState<Record<string, unknown> | null>(null);
  const [nodeHostCommand, setNodeHostCommand] = useState<string | null>(null);
  const [nodesBusy, setNodesBusy] = useState(false);
  const [nodesStatusLoading, setNodesStatusLoading] = useState(false);
  const [nodesApproveStatus, setNodesApproveStatus] = useState<string | null>(null);
  const pendingPairRequests = Array.isArray((nodesPairing as any)?.requests)
    ? ((nodesPairing as any).requests as Array<Record<string, unknown>>)
    : [];

  useEffect(() => {
    setTokenState(getToken());
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    apiFetch<{ configured: boolean }>("/me/anthropic-key", { auth: true })
      .then((r) => setAnthropicConfigured(Boolean(r.configured)))
      .catch(() => setAnthropicConfigured(null));
  }, [token]);

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatus(null);
    try {
      const res = await apiFetch<{ token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ phone, password }),
      });
      setToken(res.token);
      setTokenState(res.token);
      setStatus("Logged in.");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onLogout = () => {
    clearToken();
    setTokenState(null);
    setStatus("Logged out.");
  };

  const onSaveAnthropicKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setAnthropicStatus(null);
    setError(null);
    try {
      const res = await apiFetch<{ ok: boolean; applied: boolean }>("/me/anthropic-key", {
        method: "POST",
        auth: true,
        body: JSON.stringify({ apiKey: anthropicKey }),
      });
      setAnthropicConfigured(true);
      setAnthropicKey("");
      setAnthropicStatus(
        res.applied
          ? "Saved and applied to OpenClaw auth store."
          : "Saved. Restart OpenClaw if it doesn’t pick it up.",
      );
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const startWhatsAppPairing = async (force: boolean) => {
    setWaBusy(true);
    setError(null);
    setWaStatus(null);
    setWaConnected(null);
    try {
      const res = await apiFetch<{ ok: boolean; result: { qrDataUrl?: string; message: string } }>(
        "/me/whatsapp/login/start",
        {
          method: "POST",
          auth: true,
          body: JSON.stringify({ force }),
        },
      );
      setWaQrDataUrl(res.result.qrDataUrl ?? null);
      setWaStatus(res.result.message);
      setWaConnected(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWaBusy(false);
    }
  };

  const refreshWhatsAppStatus = async () => {
    setWaStatusLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{
        ok: boolean;
        defaultAccountId: string;
        linkedAsE164?: string | null;
        account: Record<string, unknown> | null;
      }>("/me/whatsapp/status", { auth: true });
      setWaAccount(res.account);
      setWaAccountId(res.defaultAccountId);
      setWaLinkedAs(res.linkedAsE164 ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWaStatusLoading(false);
    }
  };

  const sendWhatsAppTest = async () => {
    setWaTestBusy(true);
    setWaTestStatus(null);
    setError(null);
    try {
      const res = await apiFetch<{ ok: boolean; error?: string }>("/me/whatsapp/test-send", {
        method: "POST",
        auth: true,
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        throw new Error(res.error || "test_send_failed");
      }
      setWaTestStatus("Sent. Check your WhatsApp for a “WhatsApp is paired” message.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWaTestBusy(false);
    }
  };

  const refreshNodesStatus = async () => {
    setNodesStatusLoading(true);
    setNodesApproveStatus(null);
    setError(null);
    try {
      const res = await apiFetch<{
        ok: boolean;
        nodes: Record<string, unknown>;
        pairing: Record<string, unknown>;
        nodeHost?: { command?: string };
      }>("/me/nodes/status", { auth: true });
      setNodesStatus(res.nodes ?? null);
      setNodesPairing(res.pairing ?? null);
      setNodeHostCommand(res.nodeHost?.command ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setNodesStatusLoading(false);
    }
  };

  const approveNodePairing = async (requestId: string) => {
    setNodesBusy(true);
    setNodesApproveStatus(null);
    setError(null);
    try {
      await apiFetch<{ ok: boolean }>("/me/nodes/approve", {
        method: "POST",
        auth: true,
        body: JSON.stringify({ requestId }),
      });
      setNodesApproveStatus(
        "Approved. If the node host is running, it should show as connected within a few seconds.",
      );
      await refreshNodesStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setNodesBusy(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    void refreshWhatsAppStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void refreshNodesStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token) return;
    if (!waQrDataUrl) return;
    if (waConnected) return;

    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await apiFetch<{ ok: boolean; result: { connected: boolean; message: string } }>(
          "/me/whatsapp/login/wait",
          {
            method: "POST",
            auth: true,
            body: JSON.stringify({ timeoutMs: 2000 }),
          },
        );
        if (cancelled) return;
        setWaConnected(Boolean(res.result.connected));
        setWaStatus(res.result.message);
        if (!res.result.connected) {
          setTimeout(poll, 2500);
        }
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message);
        setTimeout(poll, 5000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [token, waQrDataUrl, waConnected]);

  return (
    <main>
      <section className="hero">
        <span className="badge">Settings</span>
        <h1>Access + WhatsApp pairing</h1>
        <p>
          Platform operator console: set the Anthropic key and pair the single shared WhatsApp inbox number (dev).
        </p>
      </section>
      <section className="card-grid">
        <div className="card">
          <h3>Web Login</h3>
          {token ? (
            <>
              <p>
                Logged in (token stored in <code>localStorage</code>).
              </p>
              <div className="cta-row">
                <button className="cta secondary" onClick={onLogout} type="button">
                  Logout
                </button>
                <a className="cta" href="/dashboard">
                  Go to dashboard
                </a>
              </div>
            </>
          ) : (
            <form onSubmit={onLogin} className="form">
              <label className="label">
                Phone
                <input
                  className="input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+15550001111"
                  required
                />
              </label>
              <label className="label">
                Password
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="your password"
                  required
                  minLength={8}
                />
              </label>
              <button className="cta" type="submit">
                Login
              </button>
            </form>
          )}
          {error ? <p className="error">Error: {error}</p> : null}
          {status ? <p className="success">{status}</p> : null}
        </div>

        <div className="card">
          <h3>WhatsApp Pairing (Dev)</h3>
          {token ? (
            <>
              <p>
                This links the platform’s dev WhatsApp number (Baileys) to the OpenClaw container.
              </p>
              <div className="hint" style={{ marginBottom: 10 }}>
                <div>
                  Status ({waAccountId ?? "default"}):{" "}
                  <code>
                    {waAccount
                      ? `running=${String(waAccount.running)} connected=${String(waAccount.connected)} linked=${String(waAccount.linked)}`
                      : "unknown"}
                  </code>
                </div>
                {waLinkedAs ? (
                  <div style={{ marginTop: 6 }}>
                    Linked as: <code>{waLinkedAs}</code>
                  </div>
                ) : null}
                <div style={{ marginTop: 6 }}>
                  Platform inbox number:{" "}
                  <code>{waLinkedAs ?? "not linked yet"}</code>
                  <span className="hint"> — this is the number users should message.</span>
                </div>
                {waAccount?.lastError ? (
                  <div style={{ marginTop: 6 }}>
                    Last error: <code>{String(waAccount.lastError)}</code>
                  </div>
                ) : null}
                <div style={{ marginTop: 8 }}>
                  <button
                    className="cta secondary"
                    type="button"
                    disabled={waStatusLoading}
                    onClick={refreshWhatsAppStatus}
                  >
                    {waStatusLoading ? "Refreshing..." : "Refresh status"}
                  </button>
                </div>
              </div>
              <p className="hint">
                On your phone: WhatsApp → Settings → Linked Devices → Link a device → scan.
              </p>
              <div className="cta-row">
                <button
                  className="cta"
                  type="button"
                  disabled={waBusy}
                  onClick={() => startWhatsAppPairing(false)}
                >
                  Generate QR
                </button>
                <button
                  className="cta secondary"
                  type="button"
                  disabled={waBusy}
                  onClick={() => startWhatsAppPairing(true)}
                >
                  Force relink
                </button>
              </div>

              {waQrDataUrl ? (
                <div style={{ marginTop: 12 }}>
                  <Image
                    src={waQrDataUrl}
                    alt="WhatsApp pairing QR"
                    width={320}
                    height={320}
                    unoptimized
                    style={{
                      width: "100%",
                      maxWidth: 320,
                      height: "auto",
                      borderRadius: 14,
                      border: "1px solid rgba(0,0,0,0.08)",
                    }}
                  />
                </div>
              ) : null}

              {waConnected ? <p className="success">WhatsApp linked.</p> : null}
              {waStatus ? <p className="hint">{waStatus}</p> : null}
              <div className="cta-row" style={{ marginTop: 10 }}>
                <button className="cta secondary" type="button" disabled={waTestBusy} onClick={sendWhatsAppTest}>
                  {waTestBusy ? "Sending..." : "Send test to me"}
                </button>
              </div>
              {waTestStatus ? <p className="success">{waTestStatus}</p> : null}
              <p className="hint">
                After pairing, outbound messages will stop failing with <code>no_active_listener</code>.
              </p>
            </>
          ) : (
            <p>Login first to generate a pairing QR.</p>
          )}
        </div>

        <div className="card">
          <h3>Run Browser On Your Machine (Node)</h3>
          {token ? (
            <>
              <p className="hint">
                Quick-commerce sites (Blinkit/Zepto/Instamart) often block server/datacenter IPs. Running the browser on your machine makes automation originate
                from your residential network, which is far more reliable.
              </p>
              <div style={{ marginTop: 8 }}>
                <button
                  className="cta secondary"
                  type="button"
                  disabled={nodesStatusLoading}
                  onClick={refreshNodesStatus}
                >
                  {nodesStatusLoading ? "Refreshing..." : "Refresh node status"}
                </button>
              </div>

              <div style={{ marginTop: 10 }}>
                <div className="hint">Start node host (run this on your laptop/desktop terminal):</div>
                <pre className="code">{nodeHostCommand ?? "Loading..."}</pre>
                <p className="hint">
                  Leave it running. The first time you start it, you’ll see a pending pairing request below — approve it once and you’re done.
                </p>
              </div>

              <div style={{ marginTop: 10 }}>
                <div className="hint">Pending pairing requests:</div>
                {pendingPairRequests.length === 0 ? (
                  <p className="hint">None. If you just started the node host, wait a few seconds and refresh.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {pendingPairRequests.map((req) => {
                      const requestId =
                        typeof req.requestId === "string" ? req.requestId : "(missing requestId)";
                      const displayName =
                        typeof req.displayName === "string" ? req.displayName : "Node host";
                      return (
                        <div
                          key={requestId}
                          style={{
                            border: "1px solid rgba(0,0,0,0.08)",
                            borderRadius: 14,
                            padding: 12,
                            background: "rgba(255,255,255,0.6)",
                          }}
                        >
                          <div className="hint" style={{ marginBottom: 8 }}>
                            <div>
                              <strong>{displayName}</strong>
                            </div>
                            <div>
                              requestId: <code>{requestId}</code>
                            </div>
                          </div>
                          <button
                            className="cta secondary"
                            type="button"
                            disabled={nodesBusy || requestId === "(missing requestId)"}
                            onClick={() => approveNodePairing(requestId)}
                          >
                            {nodesBusy ? "Approving..." : "Approve"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div style={{ marginTop: 10 }}>
                <p className="hint">Manual approve (fallback):</p>
                <ApproveForm onApprove={approveNodePairing} busy={nodesBusy} />
                {nodesApproveStatus ? <p className="success">{nodesApproveStatus}</p> : null}
              </div>

              <div style={{ marginTop: 10 }}>
                <details>
                  <summary className="hint">Debug JSON</summary>
                  <div style={{ marginTop: 10 }}>
                    <div className="hint">Nodes:</div>
                    <pre className="code">{nodesStatus ? JSON.stringify(nodesStatus, null, 2) : "—"}</pre>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <div className="hint">Pairing (pending + paired):</div>
                    <pre className="code">{nodesPairing ? JSON.stringify(nodesPairing, null, 2) : "—"}</pre>
                  </div>
                </details>
              </div>
            </>
          ) : (
            <p>Login first to manage nodes.</p>
          )}
        </div>

        <div className="card">
          <h3>Anthropic Key</h3>
          {token ? (
            <>
              <p>
                Status:{" "}
                {anthropicConfigured === null ? "Unknown" : anthropicConfigured ? "Configured" : "Not configured"}
              </p>
              <form onSubmit={onSaveAnthropicKey} className="form">
                <label className="label">
                  API key
                  <input
                    className="input"
                    value={anthropicKey}
                    onChange={(e) => setAnthropicKey(e.target.value)}
                    placeholder="sk-ant-…"
                    required
                  />
                </label>
                <button className="cta" type="submit">
                  Save key
                </button>
              </form>
              <p className="hint">
                This writes <code>ANTHROPIC_API_KEY</code> into <code>infra/docker/.env</code> and updates the OpenClaw auth
                profile in the shared Docker volume.
              </p>
              {anthropicStatus ? <p className="success">{anthropicStatus}</p> : null}
            </>
          ) : (
            <>
              <p>
                Login first, then you can set <code>ANTHROPIC_API_KEY</code> here. (Otherwise the agent will try to request it
                over WhatsApp.)
              </p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function ApproveForm(props: { onApprove: (requestId: string) => void; busy: boolean }) {
  const [requestId, setRequestId] = useState("");
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        const id = requestId.trim();
        if (!id) return;
        props.onApprove(id);
      }}
    >
      <label className="label">
        requestId
        <input
          className="input"
          value={requestId}
          onChange={(e) => setRequestId(e.target.value)}
          placeholder="paste requestId"
          required
        />
      </label>
      <button className="cta" type="submit" disabled={props.busy}>
        {props.busy ? "Approving..." : "Approve"}
      </button>
    </form>
  );
}
