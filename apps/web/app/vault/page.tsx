"use client";

import { useEffect, useState } from "react";
import { apiFetch, getToken } from "../lib/api";

type VaultEntry = {
  id: string;
  service: string;
  label: string;
  email?: string | null;
  username?: string | null;
  twoFaType?: string | null;
  createdAt?: string | null;
};

export default function VaultPage() {
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const token = typeof window !== "undefined" ? getToken() : null;

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await apiFetch<{ entries: VaultEntry[] }>("/me/vault", { auth: true });
        setEntries(res.entries || []);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  return (
    <main>
      <section className="hero">
        <span className="badge">Vault</span>
        <h1>Encrypted credentials</h1>
        <p>Manage secrets, sharing rules, and audit access from one place.</p>
      </section>
      {!token ? (
        <section className="card">
          <p>
            Login first in <a href="/settings">Settings</a>.
          </p>
        </section>
      ) : loading ? (
        <section className="card">
          <p>Loading...</p>
        </section>
      ) : error ? (
        <section className="card">
          <p className="error">Error: {error}</p>
        </section>
      ) : entries.length === 0 ? (
        <section className="card">
          <p>No vault entries yet.</p>
        </section>
      ) : (
        <section className="card-grid">
          {entries.map((entry) => (
            <div key={entry.id} className="card">
              <h3>{entry.label}</h3>
              <p>
                <strong>{entry.service}</strong>
              </p>
              <p>
                {entry.email ? <>Email: {entry.email}</> : entry.username ? <>Username: {entry.username}</> : <>No login identifier stored.</>}
              </p>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
