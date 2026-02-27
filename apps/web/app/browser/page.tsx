"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const REFRESH_MS = 1500;

type BrowserStatus = "active" | "idle" | "error" | "loading";

export default function BrowserViewPage() {
  const [src, setSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<BrowserStatus>("loading");
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState("openclaw");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const fetchScreenshot = useCallback(async () => {
    try {
      const url = `/api/browser/screenshot?profile=${encodeURIComponent(profile)}&t=${Date.now()}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setStatus("error");
        setError((json as { detail?: string }).detail ?? `HTTP ${res.status}`);
        setSrc(null);
        return;
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      setSrc((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return objectUrl;
      });
      setStatus("active");
      setError(null);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      setStatus("error");
      setError(String(err));
      setSrc(null);
    }
  }, [profile]);

  useEffect(() => {
    fetchScreenshot();
    intervalRef.current = setInterval(fetchScreenshot, REFRESH_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchScreenshot]);

  const statusLabel: Record<BrowserStatus, string> = {
    active: "Live",
    idle: "Idle",
    error: "Unavailable",
    loading: "Connecting...",
  };

  const statusColor: Record<BrowserStatus, string> = {
    active: "#22c55e",
    idle: "#f59e0b",
    error: "#ef4444",
    loading: "#6b7280",
  };

  return (
    <main style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Browser Live View</h1>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 20, padding: "4px 12px", fontSize: 13,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: statusColor[status],
              boxShadow: status === "active" ? `0 0 6px ${statusColor[status]}` : "none",
            }} />
            {statusLabel[status]}
          </span>
          {lastUpdated && (
            <span style={{ fontSize: 12, color: "#6b7280" }}>Updated {lastUpdated}</span>
          )}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 13, color: "#9ca3af" }}>Profile:</label>
            <select
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              style={{
                background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 6, color: "#fff", padding: "4px 10px", fontSize: 13,
              }}
            >
              <option value="openclaw">openclaw</option>
              <option value="chrome">chrome</option>
            </select>
            <button
              onClick={fetchScreenshot}
              style={{
                background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 6, color: "#fff", padding: "4px 12px", fontSize: 13, cursor: "pointer",
              }}
            >
              Refresh
            </button>
          </div>
        </div>

        <div style={{
          background: "#111", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12, overflow: "hidden", minHeight: 400,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {status === "error" ? (
            <div style={{ textAlign: "center", padding: 40 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🖥️</div>
              <p style={{ color: "#ef4444", margin: "0 0 8px", fontWeight: 500 }}>Browser not available</p>
              <p style={{ color: "#6b7280", margin: 0, fontSize: 13 }}>{error}</p>
              <p style={{ color: "#6b7280", margin: "12px 0 0", fontSize: 12 }}>
                The agent may be using the node browser (Mac Chrome) — visible directly on screen.
              </p>
            </div>
          ) : status === "loading" && !src ? (
            <div style={{ textAlign: "center", padding: 40 }}>
              <p style={{ color: "#6b7280" }}>Connecting to browser...</p>
            </div>
          ) : src ? (
            <img
              ref={imgRef}
              src={src}
              alt="Browser screenshot"
              style={{ width: "100%", height: "auto", display: "block" }}
            />
          ) : null}
        </div>

        <div style={{
          marginTop: 16, padding: "12px 16px",
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 8, fontSize: 13, color: "#6b7280",
        }}>
          <strong style={{ color: "#9ca3af" }}>Note:</strong> This view shows the Docker
          gateway browser (<code style={{ color: "#a78bfa" }}>openclaw</code> profile).
          When the agent uses <code style={{ color: "#a78bfa" }}>target="node"</code>, it
          controls your Mac&apos;s Chrome directly — that browser is visible on your screen.
          Auto-refreshes every {REFRESH_MS / 1000}s.
        </div>
      </div>
    </main>
  );
}
