"use client";

import { useState } from "react";
import { apiFetch } from "../lib/api";

export default function RegisterPage() {
  const [phone, setPhone] = useState("");
  const [personaName, setPersonaName] = useState("Concierge");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<{ status: string; userId?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiFetch<{ status: string; userId?: string; error?: string }>(
        "/auth/register",
        {
          method: "POST",
          body: JSON.stringify({ phone, password, personaName }),
        },
      );
      setResult(res);
      if (res.status !== "queued") {
        setError(res.error || "registration_failed");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main>
      <section className="hero">
        <span className="badge">Registration</span>
        <h1>Bring your concierge online</h1>
        <p>
          Capture the essentials now, and let the agent collect the rest lazily as
          it works.
        </p>
      </section>
      <section className="card">
        <h3>Create Your Account</h3>
        <form onSubmit={onSubmit} className="form">
          <label className="label">
            WhatsApp Phone
            <input
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+15550001111"
              required
            />
          </label>
          <label className="label">
            Concierge Name
            <input
              className="input"
              value={personaName}
              onChange={(e) => setPersonaName(e.target.value)}
              placeholder="Concierge"
            />
          </label>
          <label className="label">
            Password
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="min 8 chars"
              required
              minLength={8}
            />
          </label>
          <div className="cta-row">
            <button className="cta" type="submit" disabled={submitting}>
              {submitting ? "Registering..." : "Register"}
            </button>
            <a className="cta secondary" href="/settings">
              Already have an account?
            </a>
          </div>
        </form>
        {error ? <p className="error">Error: {error}</p> : null}
        {result?.status === "queued" ? (
          <p className="success">
            Provisioning queued. Your user id is <code>{result.userId}</code>. Next, pair WhatsApp in{" "}
            <a href="/settings">Settings</a>{" "}
            <span className="hint">
              (only needed once by the platform operator). After pairing, just message the platform WhatsApp inbox
              number to start talking to your concierge.
            </span>
          </p>
        ) : null}
      </section>
    </main>
  );
}
